const pgp = require('pg-promise')({
  error(error, e) {
    if (e.cn) {
      console.error('DB connection error:', e.cn, error.message || error);
    }
  }
});

const config = require('../../config');

const db = pgp(config.mesh_db);

module.exports = db;
