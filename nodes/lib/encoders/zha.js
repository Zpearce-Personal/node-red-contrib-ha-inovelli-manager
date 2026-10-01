"use strict";

const CLUSTER = 64561; // 0xFC31
const MANUFACTURER = 4655; // 0x122F

function notification(resolved, fields, target) {
  const { device } = resolved;
  if (!device.notification || !device.notification.zigbee) {
    throw new Error("Device does not support Zigbee LED effects");
  }
  const effectId = fields.clear ? 255 : fields.effectId;
  const base = {
    ieee: target.ieee,
    endpoint_id: device.notification.zigbee.endpoint,
    cluster_id: CLUSTER,
    cluster_type: "in",
    command_type: "server",
    manufacturer: MANUFACTURER,
  };
  let data;
  if (fields.led === "all") {
    data = {
      ...base,
      command: 1,
      params: { led_effect: effectId, led_color: fields.color, led_level: fields.level, led_duration: fields.duration },
    };
  } else {
    const led = parseInt(fields.led, 10);
    if (isNaN(led) || led < 1 || led > 7) {
      throw new Error(`Invalid LED number: ${fields.led} (1=bottom .. 7=top)`);
    }
    data = {
      ...base,
      command: 3,
      params: { led_number: led - 1, led_effect: effectId, led_color: fields.color, led_level: fields.level, led_duration: fields.duration },
    };
  }
  return [{ payload: { action: "zha.issue_zigbee_cluster_command", data } }];
}

function ledBar(resolved, section, fields, target) {
  const bar = resolved.device.ledBar && resolved.device.ledBar[section];
  if (!bar || !bar.attrs) throw new Error(`Device has no ${section} Zigbee LED bar settings`);
  const out = [];
  for (const key of ["color", "colorOff", "brightnessOn", "brightnessOff"]) {
    if (fields[key] === undefined) continue;
    const attrKey = key === "color" ? "colorOn" : key;
    out.push({
      payload: {
        action: "zha.set_zigbee_cluster_attribute",
        data: {
          ieee: target.ieee,
          endpoint_id: bar.endpoint,
          cluster_id: CLUSTER,
          cluster_type: "in",
          attribute: bar.attrs[attrKey].attribute,
          value: fields[key],
          manufacturer: MANUFACTURER,
        },
      },
    });
  }
  return out;
}

module.exports = { notification, ledBar };
