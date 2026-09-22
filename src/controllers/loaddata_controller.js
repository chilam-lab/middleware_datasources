/**
 * Carga de colecciones de datos de ocurrencias propias del usuario ("target"
 * bajo plantilla preestablecida). Porta el flujo ya usado en v1
 * (snib-middleware/src/controllers/loaddata.js), corrigiendo que aquí el
 * userid siempre viene de req.authUser (resuelto por requireAuthUser contra
 * auth_backend), nunca del body que manda el cliente.
 */
var debug = require('debug')('verbs:loaddata')
var moment = require('moment')
var verb_utils = require('../Utils/verb_utils')
const db = require('../Utils/db');

var CHAR_FORMAT = /[`!@#$%^&*()+\=\[\]{};'"\\|,<>\?~]/; // se aceptan espacios, guiones, puntos, dos puntos y diagonales

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
INSERT INTO detalle_occ_terceros (idocc, fechaevento, nombrecientifico, reino, phylum, clase, orden, familia, genero, especie, niveltaxonomico)
SELECT id, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14 FROM occ_terceros_result
`;

function dataValidation(json_data) {
  debug("dataValidation");
  var errors = [];

  json_data.forEach(function (item, index) {

    if (CHAR_FORMAT.test(item.occurrenceid) || !item.occurrenceid) {
      errors.push({ message: "Valor: " + item.occurrenceid + " Identificador con caracteres inválidos o vacío, linea: " + (index + 1) });
    }

    if (!verb_utils.isNumeric(item.decimallatitude)) {
      errors.push({ message: "Valor: " + item.decimallatitude + " Latitud no es número válido, linea: " + (index + 1) });
    }

    if (!verb_utils.isNumeric(item.decimallongitude)) {
      errors.push({ message: "Valor: " + item.decimallongitude + " Longitud no es número válido, linea: " + (index + 1) });
    }

    if (item.eventdate && !moment(item.eventdate, "YYYY-MM-DD", true).isValid() && !moment(item.eventdate, "DD/MM/YYYY", true).isValid()) {
      item.eventdate = moment().format('YYYY-MM-DD');
    }

    ['kingdom', 'phylum', 'class', 'order', 'family', 'genus', 'species', 'scientificname', 'taxonrank'].forEach(function (field) {
      if (CHAR_FORMAT.test(item[field])) {
        errors.push({ message: "Valor: " + item[field] + " (" + field + ") con caracteres inválidos, linea: " + (index + 1) });
      }
    });

    ['kingdom', 'phylum', 'class', 'order', 'family', 'taxonrank'].forEach(function (field) {
      if (!item[field]) {
        errors.push({ message: "Falta el campo requerido " + field + ", linea: " + (index + 1) });
      }
    });

    if (item.taxonrank && !['family', 'genus', 'species'].includes(item.taxonrank)) {
      errors.push({ message: "Valor: " + item.taxonrank + " Nivel taxonómico no reconocido (family|genus|species), linea: " + (index + 1) });
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
        await t.none(INSERT_OCC_QUERY, [
          item.occurrenceid,
          item.decimallatitude,
          item.decimallongitude,
          header.id,
          item.eventdate || null,
          item.scientificname || '',
          item.kingdom || '',
          item.phylum || '',
          item.class || '',
          item.order || '',
          item.family || '',
          item.genus || '',
          item.species || '',
          item.taxonrank || ''
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
      `SELECT o.*, d.fechaevento, d.nombrecientifico, d.reino, d.phylum, d.clase, d.orden, d.familia, d.genero, d.especie, d.niveltaxonomico
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
