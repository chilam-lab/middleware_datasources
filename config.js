var fs = require('fs');
var debug = require('debug')('verbs:config')
require('dotenv').config()

// Configuration file for middleware
const config = {
  port: process.env.PORT,
  email: {
    user: process.env.EUSER,
    pass: process.env.EPASS,
    host: process.env.EHOST,
    port: process.env.EPORT,
  },
  backversion: 2.1,
  server_zacatuche1: {
    host: process.env.ZACATUCHE_HOST,
    port: 22, //port used for scp
    username: process.env.USERZACATUCHE, //username to authenticate
    password: process.env.PASSZACATUCHE, //password to authenticate
    // privateKey: fs.readFileSync(process.env.PRIVATEKEYZACATUCHE), //private key to authenticate
  },
  server_manati: {
    host: process.env.MANATI_HOST,
    port: 22, //port used for scp
    username: process.env.USERMANATI, //username to authenticate
    password: process.env.PASSMANATI, //password to authenticate
    // privateKey: fs.readFileSync(process.env.PRIVATEKEYZACATUCHE), //private key to authenticate
  },
  server_species: {
    host: process.env.SPECIES_HOST, //remote host ip
    port: 22, //port used for scp
    username: process.env.USERSPECIES, //username to authenticate
    password: process.env.PASSSPECIES, //password to authenticate
    // privateKey: fs.readFileSync(process.env.PRIVATEKEYZACATUCHE), //private key to authenticate
  },
  // configuracion de urls para manejo en local
  server_regions: {
    host: process.env.REGIONS_HOST
  },
  server_snib: {
    host: process.env.SNIB_HOST
  },
  server_worldclim: {
    host: process.env.WORLDCLIM_HOST
  },
  server_gbif: {
    host: process.env.GBIF_HOST
  },
  server_dem: {
    host: process.env.DEM_HOST
  },
  mesh_db: {
    host:     process.env.MESH_DB_HOST,
    port:     process.env.MESH_DB_PORT,
    database: process.env.MESH_DB_NAME,
    user:     process.env.MESH_DB_USER,
    password: process.env.MESH_DB_PWD
  },
  SEED: process.env.SEED,
  TIME_TOKEN: process.env.TIME_TOKEN,
  SENDGRID_API_KEY: process.env.SENDGRID_API_KEY,
}

module.exports = config

