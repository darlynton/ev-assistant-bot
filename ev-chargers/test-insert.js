// test-insert.js
const db = require('./db');

const phone = 'whatsapp:+447400123456';
const carModel = 'Tesla Model 3';

db.prepare('INSERT OR REPLACE INTO users (phone, car_model) VALUES (?, ?)').run(phone, carModel);

console.log(`Inserted test user: ${phone} - ${carModel}`);