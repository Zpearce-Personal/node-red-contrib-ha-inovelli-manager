const assert = require("assert");
const helper = require("node-red-node-test-helper");
const ledManagerNode = require("../nodes/inovelli-led-manager.js");

helper.init(require.resolve("node-red"));

describe("inovelli-led-manager Node - brightness validation", function () {
  afterEach(function () {
    helper.unload();
  });

  it("rejects brightness of 11 (one above the documented maximum of 10)", function (done) {
    const flow = [
      { id: "n1", type: "inovelli-led-manager", name: "test", wires: [["n2"]] },
      { id: "n2", type: "helper" },
    ];
    helper.load(ledManagerNode, flow, function () {
      const n1 = helper.getNode("n1");
      n1.on("call:error", function (call) {
        assert.ok(/Invalid brightness value/.test(call.args[0]));
        assert.ok(/\b11\b/.test(call.args[0]));
        done();
      });
      n1.receive({ payload: { zwave: "zwave_js", switchtype: "switch", brightness: 11 } });
    });
  });

  it("accepts brightness of exactly 10 (the documented maximum) without error", function (done) {
    const flow = [
      { id: "n1", type: "inovelli-led-manager", name: "test", wires: [["n2"]] },
      { id: "n2", type: "helper" },
    ];
    helper.load(ledManagerNode, flow, function () {
      const n1 = helper.getNode("n1");
      const n2 = helper.getNode("n2");
      let errored = false;
      n1.on("call:error", function () { errored = true; });
      n2.on("input", function (msg) {
        try {
          assert.strictEqual(errored, false);
          assert.strictEqual(msg.payload.data.value, 10);
          done();
        } catch (e) {
          done(e);
        }
      });
      n1.receive({ payload: { zwave: "zwave_js", switchtype: "switch", brightness: 10 } });
    });
  });
});
