"use strict";
const convert = require("color-convert");

const WHITE = 255;

function toHue(color, generation) {
  let rgb;
  if (Array.isArray(color)) {
    if (
      color.length !== 3 ||
      color.some((c) => typeof c !== "number" || !Number.isFinite(c) || c < 0 || c > 255)
    ) {
      throw new Error(`Invalid RGB array: ${JSON.stringify(color)}`);
    }
    rgb = color;
  } else if (typeof color === "string" && color.startsWith("#")) {
    rgb = convert.hex.rgb(color);
  } else if (typeof color === "string") {
    rgb = convert.keyword.rgb(color.replace(/\s/g, "").toLowerCase());
    if (!rgb) throw new Error(`Unknown color name: ${color}`);
  } else if (typeof color === "number") {
    if (!Number.isFinite(color)) throw new Error(`Invalid hue number: ${color}`);
    if (color < 0 || color > 361) throw new Error(`Hue out of range 0-361: ${color}`);
    if (color === 361) return WHITE;
    rgb = convert.hsv.rgb([color, 100, 100]);
  } else {
    throw new Error(`Unsupported color value: ${JSON.stringify(color)}`);
  }
  if (rgb[0] === rgb[1] && rgb[1] === rgb[2]) return WHITE;
  const hslHue = convert.rgb.hsl(rgb)[0];
  const scale = generation === "lzw" ? 17 / 24 : 254 / 360;
  return Math.round(hslHue * scale);
}

function toDuration(input) {
  if (typeof input === "number") {
    if (!Number.isInteger(input) || input < 0 || input > 255) {
      throw new Error(`Duration byte out of range 0-255: ${input}`);
    }
    return input;
  }
  if (/^\d+$/.test(String(input).trim())) {
    const n = parseInt(input, 10);
    if (n < 0 || n > 255) throw new Error(`Duration byte out of range 0-255: ${input}`);
    return n;
  }
  const value = parseInt(input, 10);
  const unit = String(input).replace(/^[\s\d]+/, "").trim().toLowerCase();
  if (["second", "seconds"].includes(unit) && value >= 1 && value <= 60) return value;
  if (["minute", "minutes"].includes(unit) && value >= 1 && value <= 60) return value + 60;
  if (["hour", "hours"].includes(unit) && value >= 1 && value <= 134) return value + 120;
  if (["day", "days"].includes(unit) && value >= 1 && value <= 5) return value * 24 + 120;
  if (["forever", "indefinite", "indefinitely"].includes(unit)) return 255;
  if (["off", "disable"].includes(unit)) return 0;
  throw new Error(`Unrecognized duration: ${input}`);
}

function toLevel(input, max) {
  let n;
  if (typeof input === "number") {
    if (!Number.isInteger(input)) throw new Error(`Level out of range 0-${max}: ${input}`);
    n = input;
  } else if (typeof input === "string" && /^\d+$/.test(input.trim())) {
    n = parseInt(input, 10);
  } else {
    throw new Error(`Level out of range 0-${max}: ${input}`);
  }
  if (n < 0 || n > max) {
    throw new Error(`Level out of range 0-${max}: ${input}`);
  }
  return n;
}

module.exports = { toHue, toDuration, toLevel, WHITE };
