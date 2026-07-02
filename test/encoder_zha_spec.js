const assert = require("assert");
const enc = require("../nodes/lib/encoders/zha");
const { resolve } = require("../nodes/lib/devices");

const target = { ieee: "00:0d:6f:00:0a:bb:cc:dd" };

describe("zha notification", function () {
  it("issues command 1 for all LEDs", function () {
    const msgs = enc.notification(resolve("vzm31-sn"), {
      led: "all", effectId: 1, color: 170, level: 100, duration: 255, clear: false,
    }, target);
    assert.strictEqual(msgs.length, 1);
    assert.strictEqual(msgs[0].payload.action, "zha.issue_zigbee_cluster_command");
    assert.deepStrictEqual(msgs[0].payload.data, {
      ieee: target.ieee,
      endpoint_id: 1,
      cluster_id: 64561,
      cluster_type: "in",
      command: 1,
      command_type: "server",
      manufacturer: 4655,
      params: { led_effect: 1, led_color: 170, led_level: 100, led_duration: 255 },
    });
  });
  it("issues command 3 with 0-based led_number for individual", function () {
    const msgs = enc.notification(resolve("vzm31-sn"), {
      led: 7, effectId: 4, color: 0, level: 80, duration: 10, clear: false,
    }, target);
    assert.deepStrictEqual(msgs[0].payload.data, {
      ieee: target.ieee,
      endpoint_id: 1,
      cluster_id: 64561,
      cluster_type: "in",
      command: 3,
      command_type: "server",
      manufacturer: 4655,
      params: { led_number: 6, led_effect: 4, led_color: 0, led_level: 80, led_duration: 10 },
    });
  });
  it("clears with effect 255", function () {
    const msgs = enc.notification(resolve("vzm31-sn"), {
      led: "all", effectId: 1, color: 0, level: 100, duration: 255, clear: true,
    }, target);
    assert.strictEqual(msgs[0].payload.data.params.led_effect, 255);
  });
});

describe("zha ledBar", function () {
  it("writes one attribute per set field", function () {
    const msgs = enc.ledBar(resolve("vzm31-sn"), "main", { color: 170, brightnessOff: 5 }, target);
    assert.deepStrictEqual(msgs.map((m) => m.payload.data), [
      { ieee: target.ieee, endpoint_id: 1, cluster_id: 64561, cluster_type: "in", attribute: 95, value: 170, manufacturer: 4655 },
      { ieee: target.ieee, endpoint_id: 1, cluster_id: 64561, cluster_type: "in", attribute: 98, value: 5, manufacturer: 4655 },
    ]);
    assert.strictEqual(msgs[0].payload.action, "zha.set_zigbee_cluster_attribute");
  });
  it("targets endpoint 2 for VZM36 fan settings", function () {
    const msgs = enc.ledBar(resolve("vzm36"), "fan", { brightnessOn: 40 }, target);
    assert.strictEqual(msgs[0].payload.data.endpoint_id, 2);
    assert.strictEqual(msgs[0].payload.data.attribute, 97);
  });
});
