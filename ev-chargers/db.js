const Database = require('better-sqlite3');
const db = new Database('ev-bot.db');

db.prepare(`
  CREATE TABLE IF NOT EXISTS users (
    phone TEXT PRIMARY KEY,
    car_model TEXT
  )
`).run();

module.exports = db;