"use strict";

function publish(target, body) {
  return {
    payload: {
      action: "mqtt.publish",
      data: {
        topic: `${target.baseTopic}/${target.name}/set`,
        payload: JSON.stringify(body),
      },
    },
  };
}

function notification(resolved, fields, target) {
  const { device } = resolved;
  if (!device.notification || !device.notification.zigbee) {
    throw new Error("Device does not support Zigbee LED effects");
  }
  const effect = fields.clear ? "clear_effect" : fields.effectName;
  const common = { effect, color: fields.color, level: fields.level, duration: fields.duration };
  const body =
    fields.led === "all"
      ? { led_effect: common }
      : { individual_led_effect: { led: String(fields.led), ...common } };
  if (fields.led !== "all") {
    const led = parseInt(fields.led, 10);
    if (isNaN(led) || led < 1 || led > 7) {
      throw new Error(`Invalid LED number: ${fields.led} (1=bottom .. 7=top)`);
    }
  }
  return [publish(target, body)];
}

function ledBar(resolved, section, fields, target) {
  const bar = resolved.device.ledBar && resolved.device.ledBar[section];
  if (!bar || !bar.attrs) throw new Error(`Device has no ${section} Zigbee LED bar settings`);
  const body = {};
  for (const key of ["color", "colorOff", "brightnessOn", "brightnessOff"]) {
    if (fields[key] === undefined) continue;
    const attrKey = key === "color" ? "colorOn" : key;
    body[bar.attrs[attrKey].property + bar.suffix] = fields[key];
  }
  if (Object.keys(body).length === 0) return [];
  return [publish(target, body)];
}

module.exports = { notification, ledBar };
