"use strict";
const {
  snapToMatterColor,
  snapToMatterBrightness,
  durationToMs,
  toHue,
  hueToRgb,
} = require("../convert");

function call(action, entityId, data) {
  return { payload: { action, target: { entity_id: [entityId] }, data } };
}

function requireEntity(entities, key) {
  if (!entities[key]) throw new Error(`Matter integration requires the ${key} entity id`);
  return entities[key];
}

function clearMessages(entities) {
  const out = [];
  if (entities.light) out.push(call("light.turn_off", entities.light, {}));
  if (entities.effectSelect) out.push(call("select.select_option", entities.effectSelect, { option: "Off" }));
  return out;
}

function notification(resolved, fields, entities) {
  if (!resolved.device.notification || !resolved.device.notification.matter) {
    throw new Error("Device does not support Matter notifications");
  }
  if (fields.clear) {
    const msgs = clearMessages(entities);
    if (msgs.length === 0) throw new Error("Matter clear requires a light or effectSelect entity id");
    return { messages: msgs, clearAfterMs: null, clearMessages: [] };
  }
  let messages;
  if (fields.effectName.toLowerCase() === "solid") {
    const light = requireEntity(entities, "light");
    messages = [
      call("light.turn_on", light, {
        rgb_color: hueToRgb(toHue(fields.rawColor, "vtm")),
        brightness_pct: snapToMatterBrightness(fields.level),
      }),
    ];
  } else {
    const colorSelect = requireEntity(entities, "colorSelect");
    const effectSelect = requireEntity(entities, "effectSelect");
    messages = [
      call("select.select_option", colorSelect, { option: snapToMatterColor(fields.rawColor) }),
      call("select.select_option", effectSelect, { option: fields.effectName }),
    ];
  }
  return {
    messages,
    clearAfterMs: durationToMs(fields.duration),
    clearMessages: clearMessages(entities),
  };
}

function ledBar(resolved, fields, entities) {
  if (!resolved.device.ledBar || !resolved.device.ledBar.matter) {
    throw new Error("Device does not support Matter LED bar settings");
  }
  const out = [];
  if (fields.rawColor !== undefined) {
    out.push(call("select.select_option", requireEntity(entities, "colorSelect"), {
      option: snapToMatterColor(fields.rawColor),
    }));
  }
  if (fields.brightnessOn !== undefined) {
    out.push(call("number.set_value", requireEntity(entities, "intensityOn"), {
      value: snapToMatterBrightness(fields.brightnessOn),
    }));
  }
  if (fields.brightnessOff !== undefined) {
    out.push(call("number.set_value", requireEntity(entities, "intensityOff"), {
      value: snapToMatterBrightness(fields.brightnessOff),
    }));
  }
  return out;
}

module.exports = { notification, ledBar };
