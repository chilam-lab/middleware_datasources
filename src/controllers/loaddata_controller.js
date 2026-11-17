/**
 * Carga de colecciones de datos de ocurrencias propias del usuario ("target"
 * bajo plantilla genérica, alineada a species_v3.0). Porta el flujo ya usado
 * en v1 (snib-middleware/src/controllers/loaddata.js), corrigiendo que aquí
 * el userid siempre viene de req.authUser (resuelto por requireAuthUser
 * contra auth_backend), nunca del body que manda el cliente.
 *
 * A diferencia de v1, solo las coordenadas son estrictamente requeridas.
 * `occurrenceid` es recomendado y se autogenera si falta. Cualquier otro
 * campo (taxonomía u otros atributos propios del proveedor de datos) viaja
 * en `item.metadata` y se conserva tal cual en la columna `metadata` (jsonb)
 * de `detalle_occ_terceros`, sin validarse ni interpretarse aquí. El cruce
 * con la malla geográfica (columnas gridid_* de occ_terceros, vía
 * ST_Intersects contra las tablas grid_*_aoi) no cambia: sigue pasando en el
 * mismo INSERT, independiente de los pre-conteos por especie que se están
 * reestructurando en paralelo (esos viven en otras tablas/servicios).
 */
var debug = require('debug')('verbs:loaddata')
var moment = require('moment')
var verb_utils = require('../Utils/verb_utils')
const db = require('../Utils/db');
const { usersDb } = db;
const { getCellsForOwnedCollection } = require('../Utils/terceros_utils');

var CHAR_FORMAT = /[`!@#$%^&*()+\=\[\]{};'"\\|,<>\?~]/; // se aceptan espacios, guiones, puntos, dos puntos y diagonales

// Campos taxonómicos "conocidos" de la plantilla v1/v2, mantenidos por
// compatibilidad con consumidores existentes (getLoadedDataById). Si el
// proveedor de datos los manda dentro de metadata, se replican también en
// estas columnas; si no, quedan vacíos y el dato completo sigue disponible
// en metadata.
var LEGACY_TAXON_FIELDS = ['scientificname', 'kingdom', 'phylum', 'class', 'order', 'family', 'genus', 'species', 'taxonrank'];

// Celdas de cada punto en las mallas (meshandregions_db), en una sola consulta
// para toda la colección. Las colecciones viven en species_users_db, así que el
// cruce ya no puede ir dentro del INSERT como cuando estaban en la misma base.
const GRID_COLUMNS = ['64km', '32km', '16km', '8km', 'ageb', 'cue', 'mun', 'state'];
const CELLS_QUERY = `
SELECT p.i,
${GRID_COLUMNS.map((g) => `  (SELECT gridid_${g} FROM grid_${g}_aoi WHERE ST_Intersects(p.geom, the_geom) LIMIT 1) AS gridid_${g}`).join(',\n')}
FROM (
  SELECT i, ST_SetSRID(ST_Point(lon, lat), 4326) AS geom
  FROM unnest($1::float8[], $2::float8[]) WITH ORDINALITY AS u(lon, lat, i)
) p
ORDER BY p.i
`;

const INSERT_OCC_QUERY = `
WITH occ_terceros_result AS (
  INSERT INTO occ_terceros (id_externo, latitud, longitud, idlista, ${GRID_COLUMNS.map((g) => `gridid_${g}`).join(', ')})
  VALUES ($1, $2, $3, $4, $16, $17, $18, $19, $20, $21, $22, $23)
  RETURNING id
)
INSERT INTO detalle_occ_terceros (idocc, fechaevento, nombrecientifico, reino, phylum, clase, orden, familia, genero, especie, niveltaxonomico, metadata)
SELECT id, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb FROM occ_terceros_result
`;

function dataValidation(json_data) {
  debug("dataValidation");
  var errors = [];

  json_data.forEach(function (item, index) {

    if (item.occurrenceid && CHAR_FORMAT.test(item.occurrenceid)) {
      errors.push({ message: "Valor: " + item.occurrenceid + " Identificador con caracteres inválidos, linea: " + (index + 1) });
    }

    var lat = parseFloat(item.decimallatitude);
    if (!verb_utils.isNumeric(item.decimallatitude) || lat < -90 || lat > 90) {
      errors.push({ message: "Valor: " + item.decimallatitude + " Latitud no es número válido entre -90 y 90, linea: " + (index + 1) });
    }

    var lon = parseFloat(item.decimallongitude);
    if (!verb_utils.isNumeric(item.decimallongitude) || lon < -180 || lon > 180) {
      errors.push({ message: "Valor: " + item.decimallongitude + " Longitud no es número válido entre -180 y 180, linea: " + (index + 1) });
    }

    if (item.eventdate && !moment(item.eventdate, "YYYY-MM-DD", true).isValid() && !moment(item.eventdate, "DD/MM/YYYY", true).isValid()) {
      item.eventdate = moment().format('YYYY-MM-DD');
    }

    if (item.metadata && typeof item.metadata !== 'object') {
      errors.push({ message: "metadata debe ser un objeto, linea: " + (index + 1) });
    }

  });

  return errors;
}

exports.loadOccDataGroup = async function (req, res) {
  debug("loadOccDataGroup");

  var json_data = verb_utils.getParam(req, 'json_data', []);
  var nombre_coleccion = verb_utils.getParam(req, 'nombre_coleccion', 'mi coleccion');

  if (!Array.isArray(json_data) || json_data.length === 0) {
    return res.status(400).json({ status: 1, message: 'json_data vacío o inválido' });
  }

  json_data.forEach(function (item, index) {
    if (!item.occurrenceid) {
      item.occurrenceid = 'auto-' + (index + 1);
    }
  });

  var errors = dataValidation(json_data);

  if (errors.length > 0) {
    return res.status(400).json({ status: 1, errors: errors, message: 'registros con errores, revisar lista' });
  }

  try {
    const cells = await db.any(CELLS_QUERY, [
      json_data.map((item) => Number(item.decimallongitude)),
      json_data.map((item) => Number(item.decimallatitude)),
    ]);

    const idinsertdata = await usersDb.tx(async t => {

      const header = await t.one(
        `INSERT INTO lista_carga_terceros (userid, nombre_datos, estatus, categoria, fecha_carga, fecha_expiracion, tipo_info)
         VALUES ($1, $2, $3, $4, NOW(), NOW() + INTERVAL '1 month', $5)
         RETURNING id`,
        [req.authUser.userid, nombre_coleccion, 'activo', 'carga_datos_tercero', 'biotico']
      );

      for (const [index, item] of json_data.entries()) {
        const metadata = (item.metadata && typeof item.metadata === 'object') ? item.metadata : {};
        const legacy = LEGACY_TAXON_FIELDS.map((field) => item[field] || metadata[field] || '');
        const cell = cells[index] || {};

        await t.none(INSERT_OCC_QUERY, [
          item.occurrenceid,
          item.decimallatitude,
          item.decimallongitude,
          header.id,
          item.eventdate || null,
          ...legacy,
          JSON.stringify(metadata),
          ...GRID_COLUMNS.map((g) => cell[`gridid_${g}`] ?? null),
        ]);
      }

      return header.id;
    });

    res.status(200).json({ status: 0, message: 'ok', id: idinsertdata });

  } catch (error) {
    debug(error);
    res.status(500).json({ status: 1, message: 'Error al cargar la colección de datos' });
  }
};

exports.getProfileDataList = async function (req, res) {
  debug("getProfileDataList");

  try {
    const rows = await usersDb.any(
      'SELECT * FROM lista_carga_terceros WHERE userid = $1 ORDER BY fecha_carga DESC',
      [req.authUser.userid]
    );
    res.status(200).json({ status: 0, message: 'ok', data: rows });
  } catch (error) {
    debug(error);
    res.status(500).json({ status: 1, message: 'Error al obtener la lista de colecciones' });
  }
};

exports.getLoadedDataById = async function (req, res) {
  debug("getLoadedDataById");

  const id_data = verb_utils.getParam(req, 'id_data');

  try {
    const header = await usersDb.oneOrNone(
      'SELECT * FROM lista_carga_terceros WHERE id = $1 AND userid = $2',
      [id_data, req.authUser.userid]
    );

    if (!header) {
      return res.status(404).json({ status: 1, message: 'No encontrado' });
    }

    const rows = await usersDb.any(
      `SELECT o.*, d.fechaevento, d.nombrecientifico, d.reino, d.phylum, d.clase, d.orden, d.familia, d.genero, d.especie, d.niveltaxonomico, d.metadata
       FROM occ_terceros o
       LEFT JOIN detalle_occ_terceros d ON d.idocc = o.id
       WHERE o.idlista = $1`,
      [id_data]
    );

    res.status(200).json({ status: 0, message: 'ok', header, data: rows });
  } catch (error) {
    debug(error);
    res.status(500).json({ status: 1, message: 'Error al obtener la colección' });
  }
};

/**
 * Celdas ocupadas por una colección propia, para previsualizarla en el mapa
 * de Target (misma forma de respuesta que /mdf/getOccOnMap: {cell_id, occ}).
 */
exports.getThirdPartyCells = async function (req, res) {
  debug("getThirdPartyCells");

  const id_data = verb_utils.getParam(req, 'id_data');
  const grid_id = verb_utils.getParam(req, 'grid_id');

  if (!id_data || !grid_id) {
    return res.status(400).json({ status: 1, message: 'Faltan id_data o grid_id' });
  }

  try {
    const result = await getCellsForOwnedCollection(id_data, grid_id, req.authUser.userid);

    if (!result) {
      return res.status(404).json({ status: 1, message: 'Colección no encontrada' });
    }
    if (!result.column) {
      return res.status(400).json({
        status: 1,
        message: 'La malla seleccionada no es compatible todavía con datos de terceros (solo 64km/32km/16km/8km/ageb/cue/mun/state nacional).',
      });
    }

    res.status(200).json({ status: 0, data: result.rows });
  } catch (error) {
    debug(error);
    res.status(500).json({ status: 1, message: 'Error al obtener las celdas de la colección' });
  }
};

exports.deleteLoadedData = async function (req, res) {
  debug("deleteLoadedData");

  const id_data = verb_utils.getParam(req, 'id_data');

  if (!id_data) {
    return res.status(400).json({ status: 1, message: 'Falta id_data' });
  }

  try {
    const result = await usersDb.result(
      'DELETE FROM lista_carga_terceros WHERE id = $1 AND userid = $2',
      [id_data, req.authUser.userid]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ status: 1, message: 'No encontrado' });
    }

    res.status(200).json({ status: 0, message: 'ok' });
  } catch (error) {
    debug(error);
    res.status(500).json({ status: 1, message: 'Error al eliminar la colección' });
  }
};
