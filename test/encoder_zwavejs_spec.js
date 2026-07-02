const assert = require("assert");
const enc = require("../nodes/lib/encoders/zwavejs");
const { resolve } = require("../nodes/lib/devices");

const target = { entity_id: ["light.office"] };

describe("zwavejs notification", function () {
  it("packs the VZW 2-1 layout (worked example from Inovelli forum)", function () {
    // Chase(5), violet(190), 10%, 10s -> 96340490
    const msgs = enc.notification(resolve("vzw31-sn"), {
      led: "all", effectId: 5, color: 190, level: 10, duration: 10,
      clear: false, multicast: false,
    }, target);
    assert.strictEqual(msgs.length, 1);
    assert.deepStrictEqual(msgs[0].payload, {
      action: "zwave_js.bulk_set_partial_config_parameters",
      target,
      data: { parameter: 99, value: 96340490 },
    });
  });
  it("uses individual LED params (LED1=64 ... LED7=94)", function () {
    const msgs = enc.notification(resolve("vzw31-sn"), {
      led: 3, effectId: 4, color: 0, level: 50, duration: 255,
      clear: false, multicast: false,
    }, target);
    assert.strictEqual(msgs[0].payload.data.parameter, 74);
    assert.strictEqual(msgs[0].payload.data.value, 4 * 16777216 + 0 * 65536 + 50 * 256 + 255);
  });
  it("clears VZW with value 0", function () {
    const msgs = enc.notification(resolve("vzw31-sn"), {
      led: "all", effectId: 1, color: 0, level: 0, duration: 0,
      clear: true, multicast: false,
    }, target);
    assert.strictEqual(msgs[0].payload.data.value, 0);
  });
  it("packs the legacy LZW layout and clear value 65536", function () {
    // Legacy: color + level*256 + duration*65536 + effect*16777216
    const msgs = enc.notification(resolve("lzw31-sn"), {
      led: "all", effectId: 3, color: 170, level: 10, duration: 60,
      clear: false, multicast: false,
    }, target);
    assert.strictEqual(msgs[0].payload.data.parameter, 16);
    assert.strictEqual(msgs[0].payload.data.value, 170 + 10 * 256 + 60 * 65536 + 3 * 16777216);
    const cleared = enc.notification(resolve("lzw31-sn"), {
      led: "all", effectId: 3, color: 170, level: 10, duration: 60,
      clear: true, multicast: false,
    }, target);
    assert.strictEqual(cleared[0].payload.data.value, 65536);
  });
  it("legacy clear also triggers on effect 0 or duration 0", function () {
    const byEffect = enc.notification(resolve("lzw31-sn"), {
      led: "all", effectId: 0, color: 1, level: 1, duration: 1, clear: false, multicast: false,
    }, target);
    assert.strictEqual(byEffect[0].payload.data.value, 65536);
  });
  it("emits both LZW36 params for section all", function () {
    const msgs = enc.notification(resolve(49), {
      led: "all", effectId: 1, color: 0, level: 5, duration: 255, clear: false, multicast: false,
    }, target);
    assert.deepStrictEqual(msgs.map((m) => m.payload.data.parameter), [24, 25]);
  });
  it("emits multicast_set_value when multicast", function () {
    const msgs = enc.notification(resolve("vzw31-sn"), {
      led: "all", effectId: 1, color: 0, level: 100, duration: 255, clear: false, multicast: true,
    }, target);
    assert.strictEqual(msgs[0].payload.action, "zwave_js.multicast_set_value");
    assert.deepStrictEqual(msgs[0].payload.data, {
      command_class: 112,
      property: 99,
      value: 1 * 16777216 + 0 * 65536 + 100 * 256 + 255,
    });
  });
  it("rejects individual LEDs on devices without them", function () {
    assert.throws(() => enc.notification(resolve("lzw31-sn"), {
      led: 2, effectId: 1, color: 0, level: 5, duration: 10, clear: false, multicast: false,
    }, target));
  });
});

describe("zwavejs ledBar", function () {
  it("emits one set_config_parameter per set field (VZW)", function () {
    const msgs = enc.ledBar(resolve("vzw31-sn"), "main", { color: 170, brightnessOff: 5 }, target);
    assert.deepStrictEqual(msgs.map((m) => m.payload.data), [
      { parameter: 95, value: 170 },
      { parameter: 98, value: 5 },
    ]);
    assert.strictEqual(msgs[0].payload.action, "zwave_js.set_config_parameter");
  });
  it("emits legacy LZW36 fan params", function () {
    const msgs = enc.ledBar(resolve("lzw36"), "fan", { color: 0, brightnessOn: 7 }, target);
    assert.deepStrictEqual(msgs.map((m) => m.payload.data), [
      { parameter: 20, value: 0 },
      { parameter: 21, value: 7 },
    ]);
  });
  it("rejects colorOff on devices without a when-off color", function () {
    assert.throws(() => enc.ledBar(resolve("lzw31-sn"), "main", { colorOff: 170 }, target));
  });
});
