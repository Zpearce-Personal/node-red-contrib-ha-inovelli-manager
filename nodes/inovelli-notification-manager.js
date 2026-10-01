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

  // Config values arrive as strings from the editor; payload values may be anything.
  function pick(payload, key, cfgValue, aliasKey) {
    if (payload[key] !== undefined) return payload[key];
    if (aliasKey && payload[aliasKey] !== undefined) return payload[aliasKey];
    return cfgValue;
  }

  function InovelliNotificationManager(config) {
    RED.nodes.createNode(this, config);
    const node = this;
    node._clearTimers = new Map();

    node.on("input", (msg, send, done) => {
      const p = msg.payload && typeof msg.payload === "object" ? msg.payload : {};
      try {
        const integration = pick(p, "integration", config.integration, "zwave");
        const resolved = devices.resolve(pick(p, "model", config.model, "switchtype"));
        const { device } = resolved;
        if (!device.protocols.includes(integration)) {
          throw new Error(`${resolved.id} is not a ${integration} device`);
        }
        const clear = pick(p, "clear", config.clear) === true;
        const led = String(pick(p, "led", config.led || "all"));
        const scope = led === "all" ? "all" : "individual";
        const rawColor = numeric(pick(p, "color", config.color));
        const level = convert.toLevel(pick(p, "level", config.level, "brightness"), device.levelMax);
        const duration = convert.toDuration(numeric(pick(p, "duration", config.duration)));
        const effectInput = pick(p, "effect", config.effect);

        let msgs;
        if (integration === "zwave_js") {
          const effect = devices.effectFor(device, scope, numeric(effectInput));
          const entity = pick(p, "entity_id", config.entityid);
          const target = entity ? { entity_id: entityList(entity) } : {};
          msgs = encoders.zwave_js.notification(resolved, {
            led: led === "all" ? "all" : parseInt(led, 10),
            effectId: effect.id,
            color: convert.toHue(rawColor, device.generation),
            level, duration, clear,
            multicast: pick(p, "multicast", config.multicast) === true,
          }, target);
        } else if (integration === "zigbee2mqtt") {
          const effect = devices.effectFor(device, scope, numeric(effectInput));
          msgs = encoders.zigbee2mqtt.notification(resolved, {
            led: led === "all" ? "all" : parseInt(led, 10),
            effectName: effect.name,
            color: convert.toHue(rawColor, device.generation),
            level, duration, clear,
          }, {
            baseTopic: pick(p, "topic", config.basetopic || "zigbee2mqtt"),
            name: pick(p, "device", config.devicename),
          });
        } else if (integration === "zha") {
          const effect = devices.effectFor(device, scope, numeric(effectInput));
          msgs = encoders.zha.notification(resolved, {
            led: led === "all" ? "all" : parseInt(led, 10),
            effectId: effect.id,
            color: convert.toHue(rawColor, device.generation),
            level, duration, clear,
          }, { ieee: pick(p, "ieee", config.ieee) });
        } else if (integration === "matter") {
          const entities = {
            light: pick(p, "light_entity", config.matterlight),
            effectSelect: pick(p, "effect_entity", config.mattereffect),
            colorSelect: pick(p, "color_entity", config.mattercolor),
          };
          const result = encoders.matter.notification(resolved, {
            effectName: String(effectInput), rawColor, level, duration, clear,
          }, entities);
          msgs = result.messages;
          const timerKey = entities.effectSelect || entities.light;
          const prev = node._clearTimers.get(timerKey);
          if (prev) clearTimeout(prev);
          node._clearTimers.delete(timerKey);
          if (result.clearAfterMs && result.clearMessages.length) {
            const t = setTimeout(() => {
              node._clearTimers.delete(timerKey);
              send([result.clearMessages]);
            }, result.clearAfterMs);
            node._clearTimers.set(timerKey, t);
          }
        } else {
          throw new Error(`Unknown integration: ${integration}. Use zwave_js, zigbee2mqtt, zha, or matter.`);
        }
        send([msgs]);
        node.status({ fill: "green", shape: "dot", text: clear ? "cleared" : `sent (${resolved.id})` });
        done();
      } catch (err) {
        node.status({ fill: "red", shape: "ring", text: err.message });
        done(err);
      }
    });

    node.on("close", () => {
      for (const t of node._clearTimers.values()) clearTimeout(t);
      node._clearTimers.clear();
    });
  }
  RED.nodes.registerType("inovelli-notification-manager", InovelliNotificationManager);
};
