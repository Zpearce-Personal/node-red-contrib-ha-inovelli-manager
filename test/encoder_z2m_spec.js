const assert = require("assert");
const enc = require("../nodes/lib/encoders/zigbee2mqtt");
const { resolve } = require("../nodes/lib/devices");

const target = { baseTopic: "zigbee2mqtt", name: "Office Switch" };

describe("zigbee2mqtt notification", function () {
  it("publishes led_effect for all LEDs", function () {
    const msgs = enc.notification(resolve("vzm31-sn"), {
      led: "all", effectName: "fast_blink", color: 170, level: 100, duration: 60, clear: false,
    }, target);
    assert.strictEqual(msgs.length, 1);
    assert.strictEqual(msgs[0].payload.action, "mqtt.publish");
    assert.strictEqual(msgs[0].payload.data.topic, "zigbee2mqtt/Office Switch/set");
    assert.deepStrictEqual(JSON.parse(msgs[0].payload.data.payload), {
      led_effect: { effect: "fast_blink", color: 170, level: 100, duration: 60 },
    });
  });
  it("publishes individual_led_effect with string led 1-7", function () {
    const msgs = enc.notification(resolve("vzm31-sn"), {
      led: 7, effectName: "pulse", color: 0, level: 80, duration: 255, clear: false,
    }, target);
    assert.deepStrictEqual(JSON.parse(msgs[0].payload.data.payload), {
      individual_led_effect: { led: "7", effect: "pulse", color: 0, level: 80, duration: 255 },
    });
  });
  it("clears with clear_effect", function () {
    const msgs = enc.notification(resolve("vzm31-sn"), {
      led: "all", effectName: "solid", color: 0, level: 100, duration: 255, clear: true,
    }, target);
    assert.strictEqual(JSON.parse(msgs[0].payload.data.payload).led_effect.effect, "clear_effect");
  });
  it("rejects notification on VZM36", function () {
    assert.throws(() => enc.notification(resolve("vzm36"), {
      led: "all", effectName: "solid", color: 0, level: 100, duration: 255, clear: false,
    }, target));
  });
});

describe("zigbee2mqtt ledBar", function () {
  it("publishes set properties in one message", function () {
    const msgs = enc.ledBar(resolve("vzm31-sn"), "main", { color: 170, brightnessOn: 33 }, target);
    assert.strictEqual(msgs.length, 1);
    assert.deepStrictEqual(JSON.parse(msgs[0].payload.data.payload), {
      ledColorWhenOn: 170,
      ledIntensityWhenOn: 33,
    });
  });
  it("suffixes VZM36 fan properties", function () {
    const msgs = enc.ledBar(resolve("vzm36"), "fan", { colorOff: 0, brightnessOff: 1 }, target);
    assert.deepStrictEqual(JSON.parse(msgs[0].payload.data.payload), {
      ledColorWhenOff_2: 0,
      ledIntensityWhenOff_2: 1,
    });
  });
});
