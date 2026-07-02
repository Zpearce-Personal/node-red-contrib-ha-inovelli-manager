"use strict";

// Shared helpers for node runtime files.
function numeric(v) {
  return typeof v === "string" && /^\d+$/.test(v.trim()) ? parseInt(v, 10) : v;
}

function entityList(v) {
  return String(v).split(",").map((s) => s.trim()).filter(Boolean);
}

module.exports = { numeric, entityList };
