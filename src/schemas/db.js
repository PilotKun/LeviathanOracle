const config = require('../../config.json');
const tracer = require('../utils/tracer');

const db = config.database.postgresql?.enabled
  ? require('./postgres')
  : require('./sqlite3');

if (config.database.postgresql?.enabled) {
  tracer.info('DATABASE', 'Using PostgreSQL database.');
} else {
  tracer.info('DATABASE', 'PostgreSQL DB is disabled, Using SQLite3 local database. Make sure you have enough disk space in your local machine or server if you are hosting.');
}

module.exports = db;
