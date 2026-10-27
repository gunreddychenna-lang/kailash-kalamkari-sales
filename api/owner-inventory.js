"use strict";
// Same trusted Owner/Admin authorization and complete pagination as sales.
module.exports = require("./owner-dashboard.js").createHandler([
  ["saree_inventory", "id.asc", 25000]
]);
