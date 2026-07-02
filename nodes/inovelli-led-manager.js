module.exports = function (RED) {
  const devices = require("./lib/devices");
  const convert = require("./lib/convert");
  const encoders = {
    zwave_js: require("./lib/encoders/zwavejs"),
    zigbee2mqtt: require("./lib/encoders/zigbee2mqtt"),
    zha: require("./lib/encoders/zha"),
    matter: require("./lib/encoders/matter"),
  };

  function numeric(v) {
    return typeof v === "string" && /^\d+$/.test(v.trim()) ? parseInt(v, 10) : v;
  }
  function toColorByte(color, generation) {
    // Strings (color names, hex) are converted; numeric values (device hue bytes) pass through.
    if (typeof color === "string") {
      return convert.toHue(color, generation);
    }
    return color;
  }
  function entityList(v) {
    return String(v).split(",").map((s) => s.trim()).filter(Boolean);
  }

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
        // Collect raw active fields: payload presence or checked toggle.
        function active(payloadKey, toggleKey) {
          if (p[payloadKey] !== undefined) return numeric(p[payloadKey]);
          if (config[toggleKey]) return numeric(config[payloadKey]);
          return undefined;
        }
        // For non-matter integrations, convert color names to device hue bytes; for matter, keep raw.
        function colorForIntegration(payloadKey, toggleKey) {
          const raw = active(payloadKey, toggleKey);
          if (raw === undefined) return undefined;
          if (integration === "matter") return raw; // Keep raw for matter's snapToMatterColor
          return toColorByte(raw, device.generation);
        }
        const main = {
          color: colorForIntegration("color", "toggleColor"),
          colorOff: colorForIntegration("colorOff", "toggleColorOff"),
          brightnessOn: active("brightness", "toggleBrightness"),
          brightnessOff: active("brightnessOff", "toggleBrightnessOff"),
        };
        const fan = {
          color: colorForIntegration("fanColor", "toggleFanColor"),
          brightnessOn: active("fanBrightness", "toggleFanBrightness"),
          brightnessOff: active("fanBrightnessOff", "toggleFanBrightnessOff"),
        };
        // Validate brightness levels against device max.
        for (const fields of [main, fan]) {
          if (fields.brightnessOn !== undefined) fields.brightnessOn = convert.toLevel(fields.brightnessOn, device.levelMax);
          if (fields.brightnessOff !== undefined) fields.brightnessOff = convert.toLevel(fields.brightnessOff, device.levelMax);
        }
        const hasMain = Object.values(main).some((v) => v !== undefined);
        const hasFan = Object.values(fan).some((v) => v !== undefined);

        let msgs = [];
        if (integration === "matter") {
          if (hasMain) {
            msgs = encoders.matter.ledBar(resolved, {
              rawColor: main.color,
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
