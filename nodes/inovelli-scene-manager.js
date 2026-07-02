module.exports = function (RED) {
  const d = require("./lib/devices");

  function InovelliSceneManager(config) {
    RED.nodes.createNode(this, config);
    const node = this;
    const outputs = parseInt(config.outputs, 10) || 1;
    let mappings = [];
    try {
      mappings = JSON.parse(config.mappings || "[]");
    } catch (e) {
      node.error(`Invalid mappings JSON: ${e.message}`);
    }
    const ids = String(config.idfilter || "").split(",").map((s) => s.trim()).filter(Boolean);

    let resolved = null;
    try {
      resolved = d.resolve(config.model);
    } catch (e) {
      node.error(`Unknown model: ${config.model}`);
      node.status({ fill: "red", shape: "ring", text: `Unknown model: ${config.model}` });
    }

    // Returns {button, tap, id} or null when the message is not a scene event.
    function normalize(msg) {
      const p = msg.payload;
      if (!p) return null;
      // Bare-string payload (e.g. an mqtt-in node on a .../action subtopic).
      if (typeof p === "string") {
        if (!msg.topic) return null;
        const m = p.match(/^(aux_down|aux_up|aux_config|down|up|config)_(.+)$/);
        if (!m) return null;
        // Topic ends .../<device name>/action for the bare-action form.
        const parts = msg.topic.split("/");
        const id = parts[parts.length - 1] === "action" ? parts[parts.length - 2] : parts[parts.length - 1];
        return { id, button: m[1], tap: m[2] };
      }
      if (typeof p !== "object") return null;
      if (p.event_type === "zwave_js_value_notification" && p.event && p.event.command_class === 91) {
        return {
          id: String(p.event.node_id),
          button: d.ZWAVE_PROPERTY_KEY_TO_BUTTON[p.event.property_key],
          tap: d.ZWAVE_VALUE_RAW_TO_TAP[p.event.value_raw],
          legacy: { button: parseInt(p.event.property_key, 10), scene: p.event.value_raw },
        };
      }
      if (p.event_type === "zha_event" && p.event && typeof p.event.command === "string") {
        const m = p.event.command.match(/^(button_\d)_(.+)$/);
        if (!m) return null;
        return {
          id: String(p.event.device_ieee || p.event.device_id),
          button: d.ZHA_BUTTON[m[1]],
          tap: d.ZHA_PRESS_TO_TAP[m[2]],
        };
      }
      if (p.event_type === "state_changed" && p.event && p.event.new_state &&
          String(p.event.entity_id || "").startsWith("event.")) {
        const entity = p.event.entity_id;
        const button =
          entity === config.matterup ? "up" :
          entity === config.matterdown ? "down" :
          entity === config.matterconfig ? "config" : undefined;
        return {
          id: entity,
          button,
          tap: d.MATTER_EVENT_TO_TAP[p.event.new_state.attributes.event_type],
          matter: true,
        };
      }
      const action = typeof p.action === "string" ? p.action : undefined;
      if (msg.topic && action) {
        const m = action.match(/^(aux_down|aux_up|aux_config|down|up|config)_(.+)$/);
        if (!m) return null;
        return { id: msg.topic.split("/").pop(), button: m[1], tap: m[2] };
      }
      return null;
    }

    node.on("input", (msg, send, done) => {
      if (!resolved) return done();
      const ev = normalize(msg);
      if (!ev || ev.button === undefined || ev.tap === undefined) return done();
      // Device filter: matter is matched by entity; others by idfilter.
      if (!ev.matter && !config.passthrough && ids.length && !ids.includes(ev.id)) return done();

      const out = new Array(outputs).fill(null);
      if (resolved.device.scenes && resolved.device.scenes.legacyMap) {
        const map = d.LEGACY_SCENE_MAPS[resolved.device.scenes.legacyMap];
        for (let i = 0; i < outputs; i++) {
          if (map[i] && ev.legacy &&
              ev.legacy.button === map[i].button && ev.legacy.scene === map[i].scene) {
            out[i] = msg;
          }
        }
      } else {
        for (let i = 0; i < Math.min(outputs, mappings.length); i++) {
          if (mappings[i].button === ev.button && mappings[i].tap === ev.tap) out[i] = msg;
        }
      }
      send(out);
      done();
    });
  }
  RED.nodes.registerType("inovelli-scene-manager", InovelliSceneManager);
};
