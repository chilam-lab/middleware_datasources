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
  SEED: process.env.SEED,
  TIME_TOKEN: process.env.TIME_TOKEN,
  SENDGRID_API_KEY: process.env.SENDGRID_API_KEY,
}

module.exports = config

