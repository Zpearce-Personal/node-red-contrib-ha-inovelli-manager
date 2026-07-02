"use strict";

function msg(action, target, data) {
  return { payload: { action, target, data } };
}

function packVzw(f) {
  return f.effectId * 16777216 + f.color * 65536 + f.level * 256 + f.duration;
}

function packLzw(f) {
  return f.color + f.level * 256 + f.duration * 65536 + f.effectId * 16777216;
}

function notification(resolved, fields, target) {
  const { device, section } = resolved;
  if (!device.notification || (!device.notification.all && !device.notification.individual)) {
    throw new Error("Device does not support Z-Wave notifications");
  }
  let params;
  if (fields.led === "all") {
    params = device.notification[section] || device.notification.all;
  } else {
    const individual = device.notification.individual;
    if (!individual) throw new Error("Device does not support individual LED notifications");
    const led = parseInt(fields.led, 10);
    if (isNaN(led) || led < 1 || led > individual.length) {
      throw new Error(`Invalid LED number: ${fields.led} (1=bottom .. ${individual.length}=top)`);
    }
    params = [individual[led - 1]];
  }

  let value;
  if (device.generation === "vzw") {
    value = fields.clear ? 0 : packVzw(fields);
  } else {
    const clears = fields.clear || fields.effectId === 0 || fields.duration === 0;
    value = clears ? 65536 : packLzw(fields);
  }

  return params.map((parameter) =>
    fields.multicast
      ? msg("zwave_js.multicast_set_value", target, { command_class: 112, property: parameter, value })
      : msg("zwave_js.bulk_set_partial_config_parameters", target, { parameter, value })
  );
}

function ledBar(resolved, section, fields, target) {
  const bar = resolved.device.ledBar && resolved.device.ledBar[section];
  if (!bar) throw new Error(`Device has no ${section} LED bar parameters`);
  const out = [];
  for (const key of ["color", "colorOff", "brightnessOn", "brightnessOff"]) {
    if (fields[key] === undefined) continue;
    if (bar[key] === undefined) throw new Error(`Device does not support LED bar setting: ${key}`);
    out.push(msg("zwave_js.set_config_parameter", target, { parameter: bar[key], value: fields[key] }));
  }
  return out;
}

module.exports = { notification, ledBar, packVzw, packLzw };
