/**
 * Cálculo de redes de inferencia (análisis de comunidad): aristas fuente → destino
 * con las métricas de la versión estable (getTaxonsGroupEdges de snib-middleware).
 *
 *   ni  = celdas del nodo fuente, nj = celdas del nodo destino,
 *   nij = celdas que comparten, n = celdas de la región.
 *   ε y score = verb_utils.epsilonV1 / scoreV1 con alpha = 1/n (los mismos de Nicho).
 *
 * Como la v1, el mínimo de celdas (min_occ) filtra solo a los nodos destino
 * (nj > min_occ) y todos los pares cuentan, también los de nij = 0.
 */
const verb_utils = require('./verb_utils');

/** Aristas que se guardan del análisis (las de mayor |ε|); el resto solo cuenta en el histograma. */
const MAX_STORED_EDGES = 300000;
/** Por debajo de este |ε| una arista no se guarda (la v1 ni siquiera la dibuja con |ε| < 2). */
const MIN_STORED_ABS_EPS = 1;
/** Ancho de las barras del histograma de ε. */
const HIST_BIN = 0.5;

/** Nombre corto del nodo para la red, según el tipo de fuente. */
function nodeLabel(id_source, md) {
  const m = md || {};
  if (id_source === 'terceros') return m.nombre_datos || m.especie || 'Mis datos';
  // SNIB / GBIF: el nombre sin subgénero, como la v1 ("Aedes (Stegomyia) aegypti" → "Aedes aegypti").
  const taxon = m.especie || m.genero || m.familia || m.orden || m.clase || m.phylum || m.reino;
  if (taxon) return String(taxon).replace(/\s*\([^)]*\)/g, '').trim();
  // Uso de suelo: clave de INEGI y descripción.
  if (m.clave && m.label) return `${m.clave} - ${m.label}`;
  // DEM: rango de elevación.
  if (m.min_value != null && m.max_value != null && m.bin_index != null) {
    return `Elevación ${Number(m.min_value).toFixed(0)}–${Number(m.max_value).toFixed(0)} m`;
  }
  // WorldClim: su label ya trae el rango redondeado ("Annual Mean Temperature [-27.22 : -17.95]").
  if (m.label && /\[.*\]/.test(m.label)) return String(m.label);
  if (m.layer && m.tag) return `${m.label || m.layer} [${m.tag}]`;
  return String(m.label || m.layer || m.nombre || '');
}

/**
 * Nodos de un grupo a partir de la respuesta de get-data de cada fuente
 * ([{ id_source, data: [{ level_id, cells, metadata }] }]). Las celdas se dejan
 * solo dentro de la región y deduplicadas.
 */
function buildNodes(cellsData, grupo, regionCellsSet) {
  const nodes = new Map();
  for (const obj of cellsData || []) {
    for (const item of Array.isArray(obj.data) ? obj.data : []) {
      const id = `${obj.id_source}:${item.level_id}`;
      const prev = nodes.get(id);
      const cells = prev ? prev.cells : new Set();
      for (const c of Array.isArray(item.cells) ? item.cells : []) {
        if (!regionCellsSet || regionCellsSet.has(c)) cells.add(c);
      }
      if (!prev) {
        nodes.set(id, {
          id,
          grupo,
          id_source: obj.id_source,
          level_id: item.level_id,
          label: nodeLabel(obj.id_source, item.metadata),
          metadata: item.metadata || {},
          cells,
        });
      }
    }
  }
  return [...nodes.values()];
}

/**
 * Cruza fuente × destino. Para no comparar par contra par, arma un índice
 * celda → destinos que la ocupan; cada fuente recorre solo sus celdas, así que
 * el costo depende de las coincidencias reales y no de fuentes × destinos.
 * Devuelve las aristas con |ε| ≥ MIN_STORED_ABS_EPS (máx. MAX_STORED_EDGES,
 * las de mayor |ε|) y el histograma de ε de TODOS los pares.
 */
function computeEdges(sources, targets, n, minOcc) {
  const alpha = 1 / n;
  const dest = targets.filter(t => t.cells.size > minOcc);
  const cellToTargets = new Map();
  dest.forEach((t, j) => {
    for (const c of t.cells) {
      let list = cellToTargets.get(c);
      if (!list) cellToTargets.set(c, (list = []));
      list.push(j);
    }
  });

  const nij = new Int32Array(dest.length);
  const hist = new Map();
  let edges = [];
  let pairs = 0;
  let minAbsKept = MIN_STORED_ABS_EPS;

  for (const s of sources) {
    const ni = s.cells.size;
    if (ni === 0) continue;
    nij.fill(0);
    for (const c of s.cells) {
      const list = cellToTargets.get(c);
      if (list) for (const j of list) nij[j]++;
    }
    for (let j = 0; j < dest.length; j++) {
      const t = dest[j];
      if (t.id === s.id) continue; // el mismo nodo en ambos grupos
      const nj = t.cells.size;
      const epsilon = verb_utils.epsilonV1(nj, nij[j], ni, n, alpha);
      pairs++;
      const bin = Math.floor(epsilon / HIST_BIN) * HIST_BIN;
      hist.set(bin, (hist.get(bin) || 0) + 1);
      if (Math.abs(epsilon) < minAbsKept) continue;
      edges.push({
        source: s.id,
        target: t.id,
        nij: nij[j],
        ni,
        nj,
        n,
        epsilon,
        score: verb_utils.scoreV1(nj, nij[j], ni, n, alpha),
      });
      // Si se rebasa el tope, se quedan las de mayor |ε| y sube el corte.
      if (edges.length >= MAX_STORED_EDGES * 2) {
        edges.sort((a, b) => Math.abs(b.epsilon) - Math.abs(a.epsilon));
        edges.length = MAX_STORED_EDGES;
        minAbsKept = Math.abs(edges[edges.length - 1].epsilon);
      }
    }
  }

  edges.sort((a, b) => Math.abs(b.epsilon) - Math.abs(a.epsilon));
  const truncated = edges.length > MAX_STORED_EDGES || minAbsKept > MIN_STORED_ABS_EPS;
  if (edges.length > MAX_STORED_EDGES) edges.length = MAX_STORED_EDGES;

  const histogram = [...hist.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([desde, count]) => ({ desde, hasta: desde + HIST_BIN, count }));

  return {
    edges,
    stats: {
      pares: pairs,
      destinos_validos: dest.length,
      destinos_descartados: targets.length - dest.length,
      aristas_guardadas: edges.length,
      min_abs_eps_guardado: truncated ? minAbsKept : MIN_STORED_ABS_EPS,
      truncado: truncated,
      histograma: histogram,
    },
  };
}

/**
 * Aristas que pasan el filtro de |ε| (y signo), ya ordenadas por |ε| descendente.
 * Con epsDesde/epsHasta (una barra del histograma) se usan solo las de
 * epsDesde ≤ ε < epsHasta, y el umbral y el signo se ignoran.
 */
function filterEdges(edges, { minAbsEps = 2, signo = 'ambos', limit = 20000, offset = 0, epsDesde = null, epsHasta = null } = {}) {
  const byRange = Number.isFinite(epsDesde) && Number.isFinite(epsHasta);
  const keep = byRange
    ? edges.filter(e => e.epsilon >= epsDesde && e.epsilon < epsHasta)
    : edges.filter(e => Math.abs(e.epsilon) >= minAbsEps
      && (signo === 'ambos' || (signo === 'positivo' ? e.epsilon > 0 : e.epsilon < 0)));
  return { total: keep.length, edges: keep.slice(offset, offset + limit) };
}

const csvCell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** CSV de aristas con los mismos campos que la tabla de la v1 (más score e ids). */
function edgesToCsv(edges, nodesById) {
  const head = ['nodo_fuente', 'nodo_destino', 'nij', 'nj', 'ni', 'n', 'epsilon', 'score', 'id_fuente', 'id_destino'];
  const lines = [head.join(',')];
  for (const e of edges) {
    lines.push([
      nodesById[e.source]?.label, nodesById[e.target]?.label, e.nij, e.nj, e.ni, e.n,
      e.epsilon.toFixed(4), e.score.toFixed(4), e.source, e.target,
    ].map(csvCell).join(','));
  }
  return lines.join('\n') + '\n';
}

module.exports = { nodeLabel, buildNodes, computeEdges, filterEdges, edgesToCsv, MAX_STORED_EDGES, MIN_STORED_ABS_EPS };
