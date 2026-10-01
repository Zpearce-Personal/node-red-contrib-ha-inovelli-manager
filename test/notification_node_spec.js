const assert = require("assert");
const helper = require("node-red-node-test-helper");
const notifNode = require("../nodes/inovelli-notification-manager.js");

helper.init(require.resolve("node-red"));

function flowFor(cfg) {
  return [
    { id: "n1", type: "inovelli-notification-manager", wires: [["h"]], ...cfg },
    { id: "h", type: "helper" },
  ];
}

describe("inovelli-notification-manager", function () {
  afterEach(function () { return helper.unload(); });

  it("emits a zwave_js bulk_set message", function (done) {
    // Config color is a hue DEGREE (0-361); 0 = red = device byte 0, so the
    // packed value is deterministic: chase(5)<<24 | 0<<16 | 10<<8 | 10.
    const flow = flowFor({
      integration: "zwave_js", model: "vzw31-sn", entityid: "light.office",
      color: "0", level: "10", duration: "10", effect: "chase", led: "all",
      clear: false, multicast: false,
    });
    helper.load(notifNode, flow, function () {
      helper.getNode("h").on("input", function (msg) {
        try {
          assert.strictEqual(msg.payload.action, "zwave_js.bulk_set_partial_config_parameters");
          assert.deepStrictEqual(msg.payload.target, { entity_id: ["light.office"] });
          assert.deepStrictEqual(msg.payload.data, { parameter: 99, value: 5 * 16777216 + 10 * 256 + 10 });
          done();
        } catch (e) { done(e); }
      });
      helper.getNode("n1").receive({ payload: {} });
    });
  });

  it("payload overrides win and accept friendly formats", function (done) {
    const flow = flowFor({
      integration: "zwave_js", model: "vzw31-sn", entityid: "light.office",
      color: "0", level: "100", duration: "255", effect: "solid", led: "all",
      clear: false, multicast: false,
    });
    helper.load(notifNode, flow, function () {
      helper.getNode("h").on("input", function (msg) {
        try {
          // pulse(4)<<24 | red(0)<<16 | 50<<8 | "30 seconds"(30)
          assert.deepStrictEqual(msg.payload.data, { parameter: 99, value: 4 * 16777216 + 50 * 256 + 30 });
          done();
        } catch (e) { done(e); }
      });
      helper.getNode("n1").receive({
        payload: { effect: "Pulse", color: "red", level: 50, duration: "30 seconds" },
      });
    });
  });

  it("emits mqtt.publish for zigbee2mqtt", function (done) {
    const flow = flowFor({
      integration: "zigbee2mqtt", model: "vzm31-sn", basetopic: "zigbee2mqtt",
      devicename: "Office Switch", color: "240", level: "100", duration: "255",
      effect: "aurora", led: "all", clear: false, multicast: false,
    });
    helper.load(notifNode, flow, function () {
      helper.getNode("h").on("input", function (msg) {
        try {
          assert.strictEqual(msg.payload.action, "mqtt.publish");
          assert.strictEqual(msg.payload.data.topic, "zigbee2mqtt/Office Switch/set");
          const body = JSON.parse(msg.payload.data.payload);
          // 240 degrees (blue) -> round(240 * 254/360) = 169
          assert.deepStrictEqual(body.led_effect, { effect: "aurora", color: 169, level: 100, duration: 255 });
          done();
        } catch (e) { done(e); }
      });
      helper.getNode("n1").receive({ payload: {} });
    });
  });

  it("emits zha cluster command for individual LED", function (done) {
    const flow = flowFor({
      integration: "zha", model: "vzm31-sn", ieee: "00:0d:6f:00:0a:bb:cc:dd",
      color: "0", level: "80", duration: "10", effect: "pulse", led: "7",
      clear: false, multicast: false,
    });
    helper.load(notifNode, flow, function () {
      helper.getNode("h").on("input", function (msg) {
        try {
          assert.strictEqual(msg.payload.action, "zha.issue_zigbee_cluster_command");
          assert.strictEqual(msg.payload.data.command, 3);
          assert.strictEqual(msg.payload.data.params.led_number, 6);
          done();
        } catch (e) { done(e); }
      });
      helper.getNode("n1").receive({ payload: {} });
    });
  });

  it("emits the matter sequence for animated effects", function (done) {
    const flow = flowFor({
      integration: "matter", model: "vtm31-sn",
      matterlight: "light.office_rgb", mattereffect: "select.office_led_effect",
      mattercolor: "select.office_led_color",
      color: "240", level: "100", duration: "255", effect: "Chase", led: "all",
      clear: false, multicast: false,
    });
    helper.load(notifNode, flow, function () {
      const seen = [];
      helper.getNode("h").on("input", function (msg) {
        seen.push(msg.payload);
        if (seen.length === 2) {
          try {
            assert.deepStrictEqual(seen[0].data, { option: "Blue" });
            assert.deepStrictEqual(seen[1].data, { option: "Chase" });
            done();
          } catch (e) { done(e); }
        }
      });
      helper.getNode("n1").receive({ payload: {} });
    });
  });

  it("sends the matter clear sequence after the duration elapses", function (done) {
    this.timeout(5000);
    const flow = flowFor({
      integration: "matter", model: "vtm31-sn",
      matterlight: "light.office_rgb", mattereffect: "select.office_led_effect",
      mattercolor: "select.office_led_color",
      color: "0", level: "100", duration: "1", effect: "Solid", led: "all",
      clear: false, multicast: false,
    });
    helper.load(notifNode, flow, function () {
      const actions = [];
      helper.getNode("h").on("input", function (msg) {
        actions.push(msg.payload.action);
        if (actions.length === 3) {
          try {
            assert.deepStrictEqual(actions, [
              "light.turn_on",
              "light.turn_off",
              "select.select_option",
            ]);
            done();
          } catch (e) { done(e); }
        }
      });
      helper.getNode("n1").receive({ payload: {} });
    });
  });

  it("reports invalid input through done/error", function (done) {
    const flow = flowFor({
      integration: "zwave_js", model: "vzw31-sn", entityid: "light.office",
      color: "0", level: "100", duration: "255", effect: "solid", led: "all",
      clear: false, multicast: false,
    });
    helper.load(notifNode, flow, function () {
      const n1 = helper.getNode("n1");
      let output = false;
      helper.getNode("h").on("input", function () { output = true; });
      n1.receive({ payload: { effect: "sparkle" } });
      setTimeout(function () {
        output ? done(new Error("node emitted output despite invalid effect")) : done();
      }, 50);
    });
  });

  it("errors on a matter animated effect with no color select entity configured", function (done) {
    const flow = flowFor({
      integration: "matter", model: "vtm31-sn",
      matterlight: "light.office_rgb", mattereffect: "select.office_led_effect",
      mattercolor: "",
      color: "240", level: "100", duration: "255", effect: "Chase", led: "all",
      clear: false, multicast: false,
    });
    helper.load(notifNode, flow, function () {
      const n1 = helper.getNode("n1");
      let output = false;
      helper.getNode("h").on("input", function () { output = true; });
      n1.receive({ payload: {} });
      setTimeout(function () {
        output ? done(new Error("node emitted output despite missing color select entity")) : done();
      }, 50);
    });
  });

  it("keeps matter clear timers isolated per device", function (done) {
    this.timeout(5000);
    const flow = flowFor({
      integration: "matter", model: "vtm31-sn",
      matterlight: "light.deviceA_rgb", mattereffect: "select.deviceA_led_effect",
      mattercolor: "select.deviceA_led_color",
      color: "0", level: "100", duration: "1", effect: "Solid", led: "all",
      clear: false, multicast: false,
    });
    helper.load(notifNode, flow, function () {
      const n1 = helper.getNode("n1");
      const seen = [];
      helper.getNode("h").on("input", function (msg) { seen.push(msg.payload); });

      // Schedules device A's clear timer (duration "1" -> fires ~1s later).
      n1.receive({ payload: {} });

      // ~200ms later, a message for a completely different device arrives,
      // overriding all three matter entities and using a duration (255) that
      // never schedules its own clear. This must not cancel device A's timer.
      setTimeout(function () {
        n1.receive({
          payload: {
            light_entity: "light.deviceB_rgb",
            effect_entity: "select.deviceB_led_effect",
            color_entity: "select.deviceB_led_color",
            duration: 255,
          },
        });
      }, 200);

      setTimeout(function () {
        try {
          const clearMsgs = seen.filter((p) =>
            p.action === "light.turn_off" ||
            (p.action === "select.select_option" && p.data && p.data.option === "Off"));
          assert.ok(clearMsgs.length > 0, "expected device A's clear messages to arrive");
          clearMsgs.forEach((p) => {
            assert.deepStrictEqual(
              p.target,
              { entity_id: [p.action === "light.turn_off" ? "light.deviceA_rgb" : "select.deviceA_led_effect"] }
            );
          });
          done();
        } catch (e) { done(e); }
      }, 1600);
    });
  });

  it("errors when the payload model does not match the configured integration's protocol", function (done) {
    const flow = flowFor({
      integration: "zwave_js", model: "vzw31-sn", entityid: "light.office",
      color: "0", level: "100", duration: "255", effect: "solid", led: "all",
      clear: false, multicast: false,
    });
    helper.load(notifNode, flow, function () {
      const n1 = helper.getNode("n1");
      let output = false;
      helper.getNode("h").on("input", function () { output = true; });
      n1.receive({ payload: { model: "vzm31-sn" } });
      setTimeout(function () {
        output ? done(new Error("node emitted output despite protocol/model mismatch")) : done();
      }, 50);
    });
  });
});
