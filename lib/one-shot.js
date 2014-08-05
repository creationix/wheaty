"use strict";
module.exports = oneShot;

// Makes sure a callback is only called once.
function oneShot(callback) {
  var done = false;
  return function (err) {
    if (!done) {
      done = true;
      return callback.apply(this, arguments);
    }
    if (err) console.error(err.stack);
  }
}
