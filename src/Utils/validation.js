/**
 * Validación cruzada (k-fold) del modelo de nicho, como el proceso de
 * validación de la v1 (createtemptabletaxonsgroupvalidation + recall por
 * decil en snib-middleware/verb_utils):
 *
 *  1. Se revuelven por separado las celdas del target y el resto de las celdas
 *     de la región, y cada grupo se parte en k bloques.
 *  2. En la iteración i, el bloque i (target + resto) es de PRUEBA: sale del
 *     universo (de ni, nj, nij y n) y el modelo se entrena con lo demás.
 *  3. Cada celda de prueba del target recibe el score que le da ese modelo
 *     (suma de aportes de las covariables presentes en ella, igual que el
 *     mapa); sin covariables queda como nula.
 *  4. Recall del decil d = celdas de prueba del target con score >= umbral
 *     inferior del decil d (deciles del score de las celdas de entrenamiento),
 *     entre las que tienen score (vp / (vp + fn)). Es acumulado: el decil 10 es
 *     el 10% superior, el 9 el 20% superior, etc.
 *  5. Se promedia el recall de las k iteraciones.
 */
const verb_utils = require('./verb_utils');

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Bloque i de k de un arreglo (reparto lo más parejo posible). */
function fold(arr, i, k) {
  const start = Math.floor((arr.length * i) / k);
  const end = Math.floor((arr.length * (i + 1)) / k);
  return arr.slice(start, end);
}

/**
 * @param {object} p
 * @param {Array<{cells:number[]}>} p.targetItems  elementos del target (ya en la región)
 * @param {Array<{key:string, cells:Set<number>}>} p.covarItems covariables (ya en la región)
 * @param {Set<number>} p.regionCells celdas de la región del análisis
 * @param {number} p.n           tamaño del universo completo
 * @param {number} p.iterations  k
 * @param {number} p.min_occ     mínimo de nij por par
 * @param {number} p.min_nj      mínimo de nj por covariable
 * @param {boolean} p.useApriori score log + a priori (apriori o mapa_prob)
 * @param {boolean} p.mapaProb   pasar el score por la logística
 * @param {boolean} p.useBounded score acotado (mapa sin a priori)
 */
function runValidation(p) {
  const k = Math.max(2, Math.floor(p.iterations) || 5);
  const targetUnion = new Set();
  for (const t of p.targetItems) for (const c of t.cells) targetUnion.add(c);
  const targetCells = shuffle([...targetUnion]);
  const otherCells = shuffle([...p.regionCells].filter((c) => !targetUnion.has(c)));

  if (targetCells.length < k) {
    return { iterations: k, error: `El target tiene ${targetCells.length} celdas; se necesitan al menos ${k} para ${k} iteraciones.` };
  }

  const perIter = [];
  for (let it = 0; it < k; it++) {
    const testTarget = fold(targetCells, it, k);
    const testSet = new Set([...testTarget, ...fold(otherCells, it, k)]);
    const n_f = p.n - testSet.size;

    const without = (cells) => {
      const out = new Set();
      for (const c of cells) if (!testSet.has(c)) out.add(c);
      return out;
    };
    const targets = p.targetItems.map((t) => without(t.cells));
    const covars = p.covarItems
      .map((c) => ({ key: c.key, full: c.cells, train: without(c.cells) }))
      .filter((c) => c.train.size >= p.min_nj && c.train.size > 0);

    // Aporte de cada covariable al score de una celda (suma sobre los
    // elementos del target), con los conteos sin el bloque de prueba.
    const aportes = new Map();
    for (const tSet of targets) {
      const ni = tSet.size;
      if (ni === 0) continue;
      for (const c of covars) {
        const [small, large] = tSet.size <= c.train.size ? [tSet, c.train] : [c.train, tSet];
        let nij = 0;
        for (const x of small) if (large.has(x)) nij++;
        if (nij < p.min_occ) continue;
        const nj = c.train.size;
        const score = p.useBounded
          ? verb_utils.getScore(nj, nij, ni, n_f, { mode: 'bounded', alpha: 0.5 })
          : verb_utils.getScore(nj, nij, ni, n_f, { mode: 'log', alpha: 0.5 });
        aportes.set(c.key, (aportes.get(c.key) || 0) + score);
      }
    }

    let apriori = 0;
    if (p.useApriori) {
      const trainTarget = new Set();
      for (const tSet of targets) for (const x of tSet) trainTarget.add(x);
      const ni = trainTarget.size;
      apriori = ni > 0 && ni < n_f ? Math.log(ni / (n_f - ni)) : 0;
    }
    const finalScore = (s) => {
      if (!p.useApriori) return s;
      const v = s + apriori;
      if (!p.mapaProb) return v;
      if (v <= -700) return 0;
      if (v >= 700) return 1;
      return Math.exp(v) / (1 + Math.exp(v));
    };

    // Score de las celdas de entrenamiento (para los umbrales de decil).
    const trainScores = new Map();
    for (const c of covars) {
      const a = aportes.get(c.key);
      if (a === undefined) continue;
      for (const cell of c.train) trainScores.set(cell, (trainScores.get(cell) || 0) + a);
    }
    if (p.useApriori) {
      // Como el mapa: con a priori toda la región cuenta (sin covariables = solo a priori).
      for (const cell of p.regionCells) if (!testSet.has(cell) && !trainScores.has(cell)) trainScores.set(cell, 0);
    }
    const sorted = [...trainScores.values()].map(finalScore).sort((a, b) => b - a);
    if (sorted.length === 0) {
      perIter.push(null);
      continue;
    }

    // Score de las celdas de prueba del target con el modelo entrenado.
    const testScores = testTarget.map((cell) => {
      let s = 0;
      let any = false;
      for (const c of covars) {
        const a = aportes.get(c.key);
        if (a !== undefined && c.full.has(cell)) { s += a; any = true; }
      }
      if (!any && !p.useApriori) return null;
      return finalScore(s);
    });

    const deciles = [];
    for (let d = 10; d >= 1; d--) {
      const idx = Math.min(sorted.length - 1, Math.ceil((sorted.length * (11 - d)) / 10) - 1);
      const threshold = sorted[idx];
      let vp = 0, fn = 0, nulo = 0;
      for (const s of testScores) {
        if (s === null) nulo++;
        else if (s >= threshold) vp++;
        else fn++;
      }
      deciles.push({ decil: d, threshold, vp, fn, nulo, recall: vp + fn > 0 ? vp / (vp + fn) : null });
    }
    perIter.push({ iter: it + 1, test_target_cells: testTarget.length, deciles });
  }

  const valid = perIter.filter(Boolean);
  const deciles = [];
  for (let d = 10; d >= 1; d--) {
    const rows = valid.map((r) => r.deciles.find((x) => x.decil === d));
    const recalls = rows.map((r) => r.recall).filter((r) => r !== null);
    const sum = (f) => rows.reduce((acc, r) => acc + r[f], 0);
    deciles.push({
      decil: d,
      recall: recalls.length ? recalls.reduce((a, b) => a + b, 0) / recalls.length : null,
      recall_min: recalls.length ? Math.min(...recalls) : null,
      recall_max: recalls.length ? Math.max(...recalls) : null,
      vp: sum('vp'),
      fn: sum('fn'),
      nulo: sum('nulo'),
    });
  }

  return {
    iterations: k,
    target_cells: targetCells.length,
    deciles,
    per_iteration: valid,
  };
}

module.exports = { runValidation };
