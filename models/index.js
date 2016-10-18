var mongoose;
module.exports = db;
function db (_mongoose) {
  mongoose = _mongoose;
  return {
    db:db
  }
}
require('./master.js')(mongoose);


