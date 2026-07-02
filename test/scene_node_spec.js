const assert = require("assert");
const helper = require("node-red-node-test-helper");
const sceneNode = require("../nodes/inovelli-scene-manager.js");

helper.init(require.resolve("node-red"));

const MAPPINGS = JSON.stringify([
  { button: "up", tap: "double" },
  { button: "config", tap: "single" },
]);

const AUX_MAPPINGS = JSON.stringify([
  { button: "aux_up", tap: "single" },
  { button: "aux_config", tap: "double" },
]);

function flow21(extra) {
  return [
    { id: "n1", type: "inovelli-scene-manager", wires: [["h0"], ["h1"]],
      outputs: 2, mappings: MAPPINGS, passthrough: false, ...extra },
    { id: "h0", type: "helper" },
    { id: "h1", type: "helper" },
  ];
}

function flowAux(extra) {
  return flow21({ mappings: AUX_MAPPINGS, ...extra });
}

describe("inovelli-scene-manager", function () {
  afterEach(function () { return helper.unload(); });

  it("routes zwave_js 2-1 events by property_key and value_raw", function (done) {
    const flow = flow21({ integration: "zwave_js", model: "vzw31-sn", idfilter: "23" });
    helper.load(sceneNode, flow, function () {
      helper.getNode("h0").on("input", function () { done(); });
      helper.getNode("h1").on("input", function () { done(new Error("wrong output")); });
      helper.getNode("n1").receive({
        payload: {
          event_type: "zwave_js_value_notification",
          event: { domain: "zwave_js", node_id: 23, command_class: 91,
            property: "scene", property_key: "002", value: "KeyPressed2x", value_raw: 3 },
        },
      });
    });
  });

  it("routes zha_event commands", function (done) {
    const flow = flow21({ integration: "zha", model: "vzm31-sn", idfilter: "00:0d:6f:00:0a:bb:cc:dd" });
    helper.load(sceneNode, flow, function () {
      helper.getNode("h1").on("input", function () { done(); });
      helper.getNode("n1").receive({
        payload: {
          event_type: "zha_event",
          event: { device_ieee: "00:0d:6f:00:0a:bb:cc:dd", command: "button_3_press", args: {} },
        },
      });
    });
  });

  it("routes zigbee2mqtt action payloads by topic device name", function (done) {
    const flow = flow21({ integration: "zigbee2mqtt", model: "vzm31-sn", idfilter: "Office Switch" });
    helper.load(sceneNode, flow, function () {
      helper.getNode("h0").on("input", function () { done(); });
      helper.getNode("n1").receive({
        topic: "zigbee2mqtt/Office Switch",
        payload: { action: "up_double" },
      });
    });
  });

  it("routes matter event entity state changes", function (done) {
    const flow = flow21({
      integration: "matter", model: "vtm31-sn",
      matterup: "event.office_up", matterdown: "event.office_down", matterconfig: "event.office_config",
    });
    helper.load(sceneNode, flow, function () {
      helper.getNode("h1").on("input", function () { done(); });
      helper.getNode("n1").receive({
        payload: {
          event_type: "state_changed",
          entity_id: "event.office_config",
          event: {
            entity_id: "event.office_config",
            new_state: { attributes: { event_type: "multi_press_1" } },
          },
        },
      });
    });
  });

  it("keeps legacy LZW31 fixed-map routing", function (done) {
    const flow = [
      { id: "n1", type: "inovelli-scene-manager", wires: [["h0"]],
        integration: "zwave_js", model: "lzw31-sn", idfilter: "13",
        outputs: 1, mappings: "[]", passthrough: false },
      { id: "h0", type: "helper" },
    ];
    helper.load(sceneNode, flow, function () {
      // Legacy map index 0 for LZW31 = button 2, scene 0 (paddle up single tap)
      helper.getNode("h0").on("input", function () { done(); });
      helper.getNode("n1").receive({
        payload: {
          event_type: "zwave_js_value_notification",
          event: { domain: "zwave_js", node_id: 13, command_class: 91,
            property: "scene", property_key: "002", value: "KeyPressed", value_raw: 0 },
        },
      });
    });
  });

  it("routes zigbee2mqtt aux switch actions", function (done) {
    const flow = flowAux({ integration: "zigbee2mqtt", model: "vzm31-sn", idfilter: "Office Switch" });
    helper.load(sceneNode, flow, function () {
      helper.getNode("h1").on("input", function () { done(); });
      helper.getNode("h0").on("input", function () { done(new Error("wrong output")); });
      helper.getNode("n1").receive({
        topic: "zigbee2mqtt/Office Switch",
        payload: { action: "aux_config_double" },
      });
    });
  });

  it("routes zha aux switch button commands", function (done) {
    const flow = flowAux({ integration: "zha", model: "vzm31-sn", idfilter: "00:0d:6f:00:0a:bb:cc:dd" });
    helper.load(sceneNode, flow, function () {
      helper.getNode("h0").on("input", function () { done(); });
      helper.getNode("h1").on("input", function () { done(new Error("wrong output")); });
      helper.getNode("n1").receive({
        payload: {
          event_type: "zha_event",
          event: { device_ieee: "00:0d:6f:00:0a:bb:cc:dd", command: "button_5_press", args: {} },
        },
      });
    });
  });

  it("ignores events for other devices when passthrough is off", function (done) {
    const flow = flow21({ integration: "zwave_js", model: "vzw31-sn", idfilter: "23" });
    helper.load(sceneNode, flow, function () {
      let hit = false;
      helper.getNode("h0").on("input", function () { hit = true; });
      helper.getNode("n1").receive({
        payload: {
          event_type: "zwave_js_value_notification",
          event: { domain: "zwave_js", node_id: 99, command_class: 91,
            property: "scene", property_key: "002", value: "KeyPressed2x", value_raw: 3 },
        },
      });
      setTimeout(function () { hit ? done(new Error("should be filtered")) : done(); }, 50);
    });
  });
});
