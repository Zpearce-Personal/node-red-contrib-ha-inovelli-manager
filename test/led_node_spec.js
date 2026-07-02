const assert = require("assert");
const helper = require("node-red-node-test-helper");
const ledNode = require("../nodes/inovelli-led-manager.js");

helper.init(require.resolve("node-red"));

describe("inovelli-led-manager", function () {
  afterEach(function () { return helper.unload(); });

  it("emits one zwave_js set_config_parameter per configured field (VZW)", function (done) {
    const flow = [
      { id: "n1", type: "inovelli-led-manager", wires: [["h"]],
        integration: "zwave_js", model: "vzw31-sn", entityid: "light.office",
        color: "170", brightnessOff: "5",
        toggleColor: true, toggleColorOff: false, toggleBrightness: false,
        toggleBrightnessOff: true, toggleFanColor: false, toggleFanBrightness: false,
        toggleFanBrightnessOff: false },
      { id: "h", type: "helper" },
    ];
    helper.load(ledNode, flow, function () {
      const seen = [];
      helper.getNode("h").on("input", function (msg) {
        seen.push(msg.payload.data);
        if (seen.length === 2) {
          try {
            assert.deepStrictEqual(seen, [
              { parameter: 95, value: 170 },
              { parameter: 98, value: 5 },
            ]);
            done();
          } catch (e) { done(e); }
        }
      });
      helper.getNode("n1").receive({ payload: {} });
    });
  });

  it("emits LZW36 fan settings via payload", function (done) {
    const flow = [
      { id: "n1", type: "inovelli-led-manager", wires: [["h"]],
        integration: "zwave_js", model: "lzw36", entityid: "fan.office",
        toggleColor: false, toggleColorOff: false, toggleBrightness: false,
        toggleBrightnessOff: false, toggleFanColor: false, toggleFanBrightness: false,
        toggleFanBrightnessOff: false },
      { id: "h", type: "helper" },
    ];
    helper.load(ledNode, flow, function () {
      helper.getNode("h").on("input", function (msg) {
        try {
          assert.deepStrictEqual(msg.payload.data, { parameter: 20, value: 0 });
          done();
        } catch (e) { done(e); }
      });
      helper.getNode("n1").receive({ payload: { fanColor: "red" } });
    });
  });

  it("emits a single Z2M publish combining fields", function (done) {
    const flow = [
      { id: "n1", type: "inovelli-led-manager", wires: [["h"]],
        integration: "zigbee2mqtt", model: "vzm31-sn", basetopic: "zigbee2mqtt",
        devicename: "Office Switch", color: "170", brightness: "33",
        toggleColor: true, toggleColorOff: false, toggleBrightness: true,
        toggleBrightnessOff: false, toggleFanColor: false, toggleFanBrightness: false,
        toggleFanBrightnessOff: false },
      { id: "h", type: "helper" },
    ];
    helper.load(ledNode, flow, function () {
      helper.getNode("h").on("input", function (msg) {
        try {
          assert.deepStrictEqual(JSON.parse(msg.payload.data.payload), {
            ledColorWhenOn: 170, ledIntensityWhenOn: 33,
          });
          done();
        } catch (e) { done(e); }
      });
      helper.getNode("n1").receive({ payload: {} });
    });
  });

  it("emits matter select and number calls", function (done) {
    const flow = [
      { id: "n1", type: "inovelli-led-manager", wires: [["h"]],
        integration: "matter", model: "vtm31-sn",
        mattercolor: "select.office_led_color",
        matterintensityon: "number.office_led_intensity_on",
        matterintensityoff: "number.office_led_intensity_off",
        color: "180", brightness: "34",
        toggleColor: true, toggleColorOff: false, toggleBrightness: true,
        toggleBrightnessOff: false, toggleFanColor: false, toggleFanBrightness: false,
        toggleFanBrightnessOff: false },
      { id: "h", type: "helper" },
    ];
    helper.load(ledNode, flow, function () {
      const seen = [];
      helper.getNode("h").on("input", function (msg) {
        seen.push(msg.payload);
        if (seen.length === 2) {
          try {
            assert.strictEqual(seen[0].action, "select.select_option");
            assert.deepStrictEqual(seen[1].data, { value: 33 });
            done();
          } catch (e) { done(e); }
        }
      });
      helper.getNode("n1").receive({ payload: {} });
    });
  });
});
