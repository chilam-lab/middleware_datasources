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
const { getCellsForOwnedCollection } = require('../Utils/terceros_utils');

var CHAR_FORMAT = /[`!@#$%^&*()+\=\[\]{};'"\\|,<>\?~]/; // se aceptan espacios, guiones, puntos, dos puntos y diagonales

// Campos taxonómicos "conocidos" de la plantilla v1/v2, mantenidos por
// compatibilidad con consumidores existentes (getLoadedDataById). Si el
// proveedor de datos los manda dentro de metadata, se replican también en
// estas columnas; si no, quedan vacíos y el dato completo sigue disponible
// en metadata.
var LEGACY_TAXON_FIELDS = ['scientificname', 'kingdom', 'phylum', 'class', 'order', 'family', 'genus', 'species', 'taxonrank'];

const INSERT_OCC_QUERY = `
WITH occ_terceros_result AS (
  INSERT INTO occ_terceros (id_externo, latitud, longitud, idlista, gridid_64km, gridid_32km, gridid_16km, gridid_8km, gridid_ageb, gridid_cue, gridid_mun, gridid_state)
  VALUES (
    $1, $2, $3, $4,
    (SELECT gridid_64km FROM grid_64km_aoi WHERE ST_Intersects(ST_SetSRID(ST_Point($3, $2), 4326), the_geom) LIMIT 1),
    (SELECT gridid_32km FROM grid_32km_aoi WHERE ST_Intersects(ST_SetSRID(ST_Point($3, $2), 4326), the_geom) LIMIT 1),
    (SELECT gridid_16km FROM grid_16km_aoi WHERE ST_Intersects(ST_SetSRID(ST_Point($3, $2), 4326), the_geom) LIMIT 1),
    (SELECT gridid_8km FROM grid_8km_aoi WHERE ST_Intersects(ST_SetSRID(ST_Point($3, $2), 4326), the_geom) LIMIT 1),
    (SELECT gridid_ageb FROM grid_ageb_aoi WHERE ST_Intersects(ST_SetSRID(ST_Point($3, $2), 4326), the_geom) LIMIT 1),
    (SELECT gridid_cue FROM grid_cue_aoi WHERE ST_Intersects(ST_SetSRID(ST_Point($3, $2), 4326), the_geom) LIMIT 1),
    (SELECT gridid_mun FROM grid_mun_aoi WHERE ST_Intersects(ST_SetSRID(ST_Point($3, $2), 4326), the_geom) LIMIT 1),
    (SELECT gridid_state FROM grid_state_aoi WHERE ST_Intersects(ST_SetSRID(ST_Point($3, $2), 4326), the_geom) LIMIT 1)
  )
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
    const idinsertdata = await db.tx(async t => {

      const header = await t.one(
        `INSERT INTO lista_carga_terceros (userid, nombre_datos, estatus, categoria, fecha_carga, fecha_expiracion, tipo_info)
         VALUES ($1, $2, $3, $4, NOW(), NOW() + INTERVAL '1 month', $5)
         RETURNING id`,
        [req.authUser.userid, nombre_coleccion, 'activo', 'carga_datos_tercero', 'biotico']
      );

      for (const item of json_data) {
        const metadata = (item.metadata && typeof item.metadata === 'object') ? item.metadata : {};
        const legacy = LEGACY_TAXON_FIELDS.map((field) => item[field] || metadata[field] || '');

        await t.none(INSERT_OCC_QUERY, [
          item.occurrenceid,
          item.decimallatitude,
          item.decimallongitude,
          header.id,
          item.eventdate || null,
          ...legacy,
          JSON.stringify(metadata),
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
    const rows = await db.any(
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
    const header = await db.oneOrNone(
      'SELECT * FROM lista_carga_terceros WHERE id = $1 AND userid = $2',
      [id_data, req.authUser.userid]
    );

    if (!header) {
      return res.status(404).json({ status: 1, message: 'No encontrado' });
    }

    const rows = await db.any(
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
    const result = await db.result(
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
