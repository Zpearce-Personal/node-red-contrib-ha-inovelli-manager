const assert = require("assert");
const { toHue, toDuration, toLevel } = require("../nodes/lib/convert");

describe("toHue", function () {
  it("converts keywords for 2-1 generation (254/360 scale)", function () {
    assert.strictEqual(toHue("red", "vzw"), 0);
    assert.strictEqual(toHue("blue", "vzw"), Math.round(240 * (254 / 360))); // 169
  });
  it("converts keywords for legacy generation (17/24 scale)", function () {
    assert.strictEqual(toHue("blue", "lzw"), Math.round(240 * (17 / 24))); // 170
  });
  it("accepts hex, RGB array, and hue number", function () {
    assert.strictEqual(toHue("#ff0000", "vzw"), 0);
    assert.strictEqual(toHue([0, 0, 255], "vzw"), 169);
    assert.strictEqual(toHue(240, "vzw"), 169);
  });
  it("maps greys and 361 to white (255)", function () {
    assert.strictEqual(toHue([200, 200, 200], "vzw"), 255);
    assert.strictEqual(toHue(361, "lzw"), 255);
    assert.strictEqual(toHue("white", "vzm"), 255);
  });
  it("throws on invalid input", function () {
    assert.throws(() => toHue(-1, "vzw"));
    assert.throws(() => toHue([300, 0, 0], "vzw"));
    assert.throws(() => toHue("notacolor", "vzw"));
    assert.throws(() => toHue({}, "vzw"));
  });
  it("throws on NaN and non-finite numbers", function () {
    assert.throws(() => toHue([NaN, 0, 0], "vzw"));
    assert.throws(() => toHue(NaN, "vzw"));
  });
});

describe("toDuration", function () {
  it("passes through raw bytes", function () {
    assert.strictEqual(toDuration(10), 10);
    assert.strictEqual(toDuration("255"), 255);
  });
  it("encodes unit strings", function () {
    assert.strictEqual(toDuration("30 seconds"), 30);
    assert.strictEqual(toDuration("1 minute"), 61);
    assert.strictEqual(toDuration("60 minutes"), 120);
    assert.strictEqual(toDuration("1 hour"), 121);
    assert.strictEqual(toDuration("134 hours"), 254);
    assert.strictEqual(toDuration("2 days"), 168);
    assert.strictEqual(toDuration("forever"), 255);
    assert.strictEqual(toDuration("off"), 0);
  });
  it("throws on invalid values", function () {
    assert.throws(() => toDuration(256));
    assert.throws(() => toDuration(-1));
    assert.throws(() => toDuration("135 hours"));
    assert.throws(() => toDuration("6 days"));
    assert.throws(() => toDuration("soon"));
  });
  it("throws on NaN and non-integer numbers", function () {
    assert.throws(() => toDuration(NaN));
    assert.throws(() => toDuration(Infinity));
    assert.throws(() => toDuration(10.5));
  });
});

describe("toLevel", function () {
  it("validates against the device max", function () {
    assert.strictEqual(toLevel(10, 10), 10);
    assert.strictEqual(toLevel("55", 100), 55);
    assert.throws(() => toLevel(11, 10));
    assert.throws(() => toLevel(-1, 100));
    assert.throws(() => toLevel("high", 100));
  });
  it("throws on non-integer strings", function () {
    assert.throws(() => toLevel("10.5", 100));
    assert.throws(() => toLevel("10abc", 100));
  });
});
