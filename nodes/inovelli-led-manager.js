module.exports = function (RED) {
  const devices = require("./lib/devices");
  const convert = require("./lib/convert");
  const { numeric, entityList } = require("./lib/util");
  const encoders = {
    zwave_js: require("./lib/encoders/zwavejs"),
    zigbee2mqtt: require("./lib/encoders/zigbee2mqtt"),
    zha: require("./lib/encoders/zha"),
    matter: require("./lib/encoders/matter"),
  };

  function InovelliLEDManager(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    node.on("input", (msg, send, done) => {
      const p = msg.payload && typeof msg.payload === "object" ? msg.payload : {};
      try {
        const integration = p.integration || p.zwave || config.integration;
        const resolved = devices.resolve(p.model || p.switchtype || config.model);
        const { device } = resolved;
        if (!device.protocols.includes(integration)) {
          throw new Error(`${resolved.id} is not a ${integration} device`);
        }
        const gen = device.generation;
        // Collect active fields: payload presence or checked toggle.
        function active(payloadKey, toggleKey) {
          if (p[payloadKey] !== undefined) return numeric(p[payloadKey]);
          if (config[toggleKey]) return numeric(config[payloadKey]);
          return undefined;
        }
        const main = {
          color: active("color", "toggleColor"),
          colorOff: active("colorOff", "toggleColorOff"),
          brightnessOn: active("brightness", "toggleBrightness"),
          brightnessOff: active("brightnessOff", "toggleBrightnessOff"),
        };
        const fan = {
          color: active("fanColor", "toggleFanColor"),
          brightnessOn: active("fanBrightness", "toggleFanBrightness"),
          brightnessOff: active("fanBrightnessOff", "toggleFanBrightnessOff"),
        };
        // Normalize values.
        for (const fields of [main, fan]) {
          if (fields.color !== undefined) fields.color = convert.toHue(fields.color, gen);
          if (fields.colorOff !== undefined) fields.colorOff = convert.toHue(fields.colorOff, gen);
          if (fields.brightnessOn !== undefined) fields.brightnessOn = convert.toLevel(fields.brightnessOn, device.levelMax);
          if (fields.brightnessOff !== undefined) fields.brightnessOff = convert.toLevel(fields.brightnessOff, device.levelMax);
        }
        const hasMain = Object.values(main).some((v) => v !== undefined);
        const hasFan = Object.values(fan).some((v) => v !== undefined);

        let msgs = [];
        if (integration === "matter") {
          if (hasMain) {
            msgs = encoders.matter.ledBar(resolved, {
              rawColor: main.color !== undefined ? numeric(p.color !== undefined ? p.color : config.color) : undefined,
              brightnessOn: main.brightnessOn,
              brightnessOff: main.brightnessOff,
            }, {
              colorSelect: p.color_entity || config.mattercolor,
              intensityOn: p.intensity_on_entity || config.matterintensityon,
              intensityOff: p.intensity_off_entity || config.matterintensityoff,
            });
          }
        } else {
          let target;
          if (integration === "zwave_js") {
            const entity = p.entity_id || config.entityid;
            target = entity ? { entity_id: entityList(entity) } : {};
          } else if (integration === "zigbee2mqtt") {
            target = { baseTopic: p.topic || config.basetopic || "zigbee2mqtt", name: p.device || config.devicename };
          } else {
            target = { ieee: p.ieee || config.ieee };
          }
          const enc = encoders[integration];
          if (!enc) throw new Error(`Unknown integration: ${integration}`);
          if (hasMain) msgs = msgs.concat(enc.ledBar(resolved, "main", main, target));
          if (hasFan) msgs = msgs.concat(enc.ledBar(resolved, "fan", fan, target));
        }
        if (msgs.length === 0) throw new Error("No LED bar fields set (enable a toggle or pass values in msg.payload)");
        send([msgs]);
        node.status({ fill: "green", shape: "dot", text: `sent ${msgs.length} (${resolved.id})` });
        done();
      } catch (err) {
        node.status({ fill: "red", shape: "ring", text: err.message });
        done(err);
      }
    });
  }
  RED.nodes.registerType("inovelli-led-manager", InovelliLEDManager);
};
