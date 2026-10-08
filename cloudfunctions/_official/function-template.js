"use strict";

const { main } = require("./runtime.cjs");

function createHandler(entry) {
  return async function handler(event) {
    return main(entry, event);
  };
}

module.exports = { createHandler };
