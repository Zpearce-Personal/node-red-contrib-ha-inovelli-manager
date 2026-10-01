const assert = require("assert");
const d = require("../nodes/lib/devices");

describe("resolve", function () {
  it("resolves canonical ids", function () {
    assert.strictEqual(d.resolve("vzw31-sn").id, "vzw31-sn");
    assert.strictEqual(d.resolve("VZM31-SN").id, "vzm31-sn");
  });
  it("resolves legacy aliases and numeric switchtypes", function () {
    assert.strictEqual(d.resolve("dimmer").id, "lzw31-sn");
    assert.strictEqual(d.resolve(8).id, "lzw30-sn");
    assert.strictEqual(d.resolve(16).id, "lzw31-sn");
    const fan = d.resolve(25);
    assert.strictEqual(fan.id, "lzw36");
    assert.strictEqual(fan.section, "fan");
    assert.strictEqual(d.resolve(49).section, "all");
    assert.strictEqual(d.resolve(5).id, "lzw30-sn"); // led-manager legacy value
    assert.strictEqual(d.resolve("blue 2-1").id, "vzm31-sn");
    assert.strictEqual(d.resolve("red 2-1").id, "vzw31-sn");
  });
  it("throws on unknown models", function () {
    assert.throws(() => d.resolve("toaster"));
  });
});

describe("registry data", function () {
  it("VZW31-SN has 2-1 Z-Wave notification params", function () {
    const { device } = d.resolve("vzw31-sn");
    assert.deepStrictEqual(device.notification.all, [99]);
    assert.deepStrictEqual(device.notification.individual, [64, 69, 74, 79, 84, 89, 94]);
    assert.strictEqual(device.levelMax, 100);
    assert.strictEqual(device.generation, "vzw");
  });
  it("legacy devices keep their params and 0-10 levels", function () {
    const { device } = d.resolve("lzw31-sn");
    assert.deepStrictEqual(device.notification.all, [16]);
    assert.strictEqual(device.levelMax, 10);
    assert.deepStrictEqual(device.ledBar.main, { color: 13, brightnessOn: 14, brightnessOff: 15 });
  });
  it("LZW36 sections address light and fan params", function () {
    const { device } = d.resolve("lzw36");
    assert.deepStrictEqual(device.notification.all, [24, 25]);
    assert.deepStrictEqual(device.notification.main, [24]);
    assert.deepStrictEqual(device.notification.fan, [25]);
    assert.deepStrictEqual(device.ledBar.fan, { color: 20, brightnessOn: 21, brightnessOff: 23 });
  });
  it("VZM36 is config-only with endpoint sections", function () {
    const { device } = d.resolve("vzm36");
    assert.strictEqual(device.notification, undefined);
    assert.strictEqual(device.scenes, undefined);
    assert.strictEqual(device.ledBar.main.endpoint, 1);
    assert.strictEqual(device.ledBar.fan.endpoint, 2);
    assert.strictEqual(device.ledBar.main.suffix, "_1");
  });
});

describe("effectFor", function () {
  it("maps 2-1 names and ints for both scopes", function () {
    const { device } = d.resolve("vzw31-sn");
    assert.deepStrictEqual(d.effectFor(device, "all", "aurora"), { id: 8, name: "aurora" });
    assert.deepStrictEqual(d.effectFor(device, "all", "Slow Siren"), { id: 19, name: "slow_siren" });
    assert.deepStrictEqual(d.effectFor(device, "all", 17), { id: 17, name: "fast_chase" });
    assert.deepStrictEqual(d.effectFor(device, "individual", "falling"), { id: 6, name: "falling" });
    assert.deepStrictEqual(d.effectFor(device, "individual", 255), { id: 255, name: "clear_effect" });
  });
  it("rejects effects invalid for scope or device", function () {
    const vzw = d.resolve("vzw31-sn").device;
    assert.throws(() => d.effectFor(vzw, "individual", "slow_siren"));
    const lzw30 = d.resolve("lzw30-sn").device;
    assert.throws(() => d.effectFor(lzw30, "all", "chase"));
    assert.deepStrictEqual(d.effectFor(lzw30, "all", "pulse"), { id: 4, name: "pulse" });
    const lzw31 = d.resolve("lzw31-sn").device;
    assert.deepStrictEqual(d.effectFor(lzw31, "all", "chase"), { id: 2, name: "chase" });
  });
});
