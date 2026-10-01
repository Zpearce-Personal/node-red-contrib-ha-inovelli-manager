const assert = require("assert");
const enc = require("../nodes/lib/encoders/matter");
const { resolve } = require("../nodes/lib/devices");

const entities = {
  light: "light.office_rgb_indicator",
  effectSelect: "select.office_led_effect",
  colorSelect: "select.office_led_color",
};

describe("matter notification", function () {
  it("uses light.turn_on for Solid", function () {
    const r = enc.notification(resolve("vtm31-sn"), {
      effectName: "Solid", rawColor: "red", level: 50, duration: 10, clear: false,
    }, entities);
    assert.strictEqual(r.messages.length, 1);
    assert.deepStrictEqual(r.messages[0].payload, {
      action: "light.turn_on",
      target: { entity_id: ["light.office_rgb_indicator"] },
      data: { rgb_color: [255, 0, 0], brightness_pct: 50 },
    });
    assert.strictEqual(r.clearAfterMs, 10000);
    assert.strictEqual(r.clearMessages.length, 2);
  });
  it("uses selects for animated effects", function () {
    const r = enc.notification(resolve("vtm31-sn"), {
      effectName: "Chase", rawColor: "#0000ff", level: 64, duration: 255, clear: false,
    }, entities);
    assert.deepStrictEqual(r.messages[0].payload, {
      action: "select.select_option",
      target: { entity_id: ["select.office_led_color"] },
      data: { option: "Blue" },
    });
    assert.deepStrictEqual(r.messages[1].payload, {
      action: "select.select_option",
      target: { entity_id: ["select.office_led_effect"] },
      data: { option: "Chase" },
    });
    assert.strictEqual(r.clearAfterMs, null);
  });
  it("clear sends light.turn_off and effect Off", function () {
    const r = enc.notification(resolve("vtm31-sn"), {
      effectName: "Solid", rawColor: "red", level: 50, duration: 255, clear: true,
    }, entities);
    assert.strictEqual(r.messages[0].payload.action, "light.turn_off");
    assert.deepStrictEqual(r.messages[1].payload.data, { option: "Off" });
    assert.strictEqual(r.clearAfterMs, null);
  });
});

describe("matter ledBar", function () {
  it("sets color select and intensity numbers", function () {
    const msgs = enc.ledBar(resolve("vtm31-sn"), {
      rawColor: "cyan", brightnessOn: 34, brightnessOff: 2,
    }, {
      colorSelect: "select.office_led_color",
      intensityOn: "number.office_led_intensity_on",
      intensityOff: "number.office_led_intensity_off",
    });
    assert.deepStrictEqual(msgs.map((m) => m.payload.action), [
      "select.select_option", "number.set_value", "number.set_value",
    ]);
    assert.deepStrictEqual(msgs[1].payload.data, { value: 33 }); // snapped
    assert.deepStrictEqual(msgs[2].payload.data, { value: 1 });
  });
});
