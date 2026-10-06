/**
 * Utilidades compartidas para exponer colecciones de terceros ("Mis datos")
 * como una fuente más en el análisis de Nicho Ecológico (mapa de presencia en
 * target-step y ensamble target/covariables en getEpsScrRelation).
 *
 * El cruce con la malla ya se calculó al cargar la colección (ver
 * loaddata_controller.js, columnas gridid_* de occ_terceros), así que aquí
 * solo se resuelve qué columna corresponde al grid_id elegido en el wizard.
 */
const db = require('./db');

const RESOLUTION_COLUMN = {
  '64km': 'gridid_64km',
  '32km': 'gridid_32km',
  '16km': 'gridid_16km',
  '8km': 'gridid_8km',
  'ageb': 'gridid_ageb',
  'cue': 'gridid_cue',
  'mun': 'gridid_mun',
  'state': 'gridid_state',
};

/**
 * Resuelve la columna de occ_terceros que corresponde a un grid_id del
 * catálogo de mallas (cat_grid). Regresa null si la malla no es una de las
 * 8 resoluciones nacionales soportadas por la carga de terceros.
 */
async function resolveColumnForGrid(grid_id) {
  const gridRow = await db.oneOrNone('SELECT resolution FROM cat_grid WHERE grid_id = $1', [grid_id]);
  return (gridRow && RESOLUTION_COLUMN[gridRow.resolution]) || null;
}

/**
 * Verifica que id_data pertenezca a userid y, si es así, regresa las celdas
 * ocupadas por esa colección para el grid_id dado. userid debe venir siempre
 * de req.authUser (sesión verificada), nunca del body del cliente.
 */
async function getCellsForOwnedCollection(id_data, grid_id, userid) {
  if (!userid) return null;

  const header = await db.oneOrNone(
    'SELECT id, nombre_datos FROM lista_carga_terceros WHERE id = $1 AND userid = $2',
    [id_data, userid]
  );
  if (!header) return null;

  const column = await resolveColumnForGrid(grid_id);
  if (!column) return { header, column: null, rows: [] };

  const rows = await db.any(
    `SELECT ${column} AS cell_id, COUNT(*) AS occ
     FROM occ_terceros
     WHERE idlista = $1 AND ${column} IS NOT NULL
     GROUP BY ${column}`,
    [id_data]
  );

  return {
    header,
    column,
    rows: rows.map((r) => ({ cell_id: Number(r.cell_id), occ: Number(r.occ) })),
  };
}

// Orden preferido de llaves de contexto; las demás van después, alfabéticas.
const CONTEXT_KEY_ORDER = [
  'kingdom', 'phylum', 'class', 'order', 'family', 'genus', 'species',
  'scientificname', 'taxonrank', 'commonname',
];
const MAX_CONTEXT_VALUES = 3;

/**
 * Resume los metadatos libres de una colección (detalle_occ_terceros.metadata,
 * lo que el usuario subió además de las coordenadas) para mostrarlos como
 * contexto en los resultados del análisis: por cada llave, sus valores
 * distintos (hasta MAX_CONTEXT_VALUES, con "(+N)" si hay más).
 */
async function getCollectionContext(id_data) {
  const rows = await db.any(
    `SELECT e.key AS k,
            COUNT(DISTINCT e.value) AS distintos,
            (ARRAY_AGG(DISTINCT e.value ORDER BY e.value))[1:$2] AS valores
     FROM occ_terceros o
     JOIN detalle_occ_terceros d ON d.idocc = o.id,
          jsonb_each_text(d.metadata) e
     WHERE o.idlista = $1 AND e.value IS NOT NULL AND e.value <> ''
     GROUP BY e.key`,
    [id_data, MAX_CONTEXT_VALUES]
  );
  const total = await db.one('SELECT COUNT(*)::int AS n FROM occ_terceros WHERE idlista = $1', [id_data]);

  const rank = (k) => {
    const i = CONTEXT_KEY_ORDER.indexOf(k.toLowerCase());
    return i === -1 ? CONTEXT_KEY_ORDER.length : i;
  };
  rows.sort((a, b) => rank(a.k) - rank(b.k) || a.k.localeCompare(b.k));

  const contexto = {};
  const unicos = {};
  for (const r of rows) {
    const distintos = Number(r.distintos);
    const extra = distintos > r.valores.length ? ` (+${distintos - r.valores.length})` : '';
    contexto[r.k] = r.valores.join(', ') + extra;
    if (distintos === 1) unicos[r.k.toLowerCase()] = r.valores[0];
  }

  return { registros: total.n, contexto, unicos };
}

module.exports = { RESOLUTION_COLUMN, resolveColumnForGrid, getCellsForOwnedCollection, getCollectionContext };
