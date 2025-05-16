// view-users.js
const db = require('./db');

const users = db.prepare('SELECT * FROM users').all();

if (users.length === 0) {
  console.log("No users found in the database.");
} else {
  console.log("Users in database:");
  users.forEach(user => {
    console.log(`${user.phone} => ${user.car_model}`);
  });
}