const pgp = require('pg-promise')({
  error(error, e) {
    if (e.cn) {
      console.error('DB connection error:', e.cn, error.message || error);
    }
  }
});

const config = require('../../config');

// Mallas, regiones y catálogo de fuentes (meshandregions_db).
const db = pgp(config.mesh_db);
// Datos de usuarios: historial de análisis y colecciones propias (species_users_db).
const usersDb = pgp(config.users_db);

module.exports = db;
module.exports.usersDb = usersDb;
