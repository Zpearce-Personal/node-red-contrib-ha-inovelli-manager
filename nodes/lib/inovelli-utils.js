'use strict';

const convert = require('color-convert');

const SWITCHES = {
  'lzw30-sn': { name: 'LZW30-SN', effectParameter: 8, scene: ['up_1x', 'up_2x', 'up_3x', 'up_4x', 'up_5x', 'down_1x', 'down_2x', 'down_3x', 'down_4x', 'down_5x', 'config_1x', 'config_2x', 'config_3x'] },
  'lzw31-sn': { name: 'LZW31-SN', effectParameter: 16, scene: ['up_1x', 'up_2x', 'up_3x', 'up_4x', 'up_5x', 'up_hold', 'up_release', 'down_1x', 'down_2x', 'down_3x', 'down_4x', 'down_5x', 'down_hold', 'down_release', 'config_1x'] },
  'lzw36': { name: 'LZW36', effectParameter: 16, scene: ['light_up_1x', 'light_up_2x', 'light_up_3x', 'light_up_4x', 'light_up_5x', 'light_down_1x', 'light_down_2x', 'light_down_3x', 'light_down_4x', 'light_down_5x', 'fan_up_1x', 'fan_up_2x', 'fan_up_3x', 'fan_down_1x', 'fan_down_2x', 'fan_down_3x'] },
  'lzw45': { name: 'LZW45', effectParameter: 8, scene: ['up_1x', 'up_2x', 'up_3x', 'up_4x', 'up_5x', 'down_1x', 'down_2x', 'down_3x', 'down_4x', 'down_5x', 'config_1x', 'config_2x', 'config_3x'] },
  'lzw31': { name: 'LZW31', effectParameter: 16, scene: ['up_1x', 'up_2x', 'up_3x', 'up_4x', 'up_5x', 'down_1x', 'down_2x', 'down_3x', 'down_4x', 'down_5x', 'config_1x', 'config_2x', 'config_3x'] },
  'dimmer': { name: 'dimmer', effectParameter: 16, scene: ['up_1x', 'up_2x', 'up_3x', 'up_4x', 'up_5x', 'down_1x', 'down_2x', 'down_3x', 'down_4x', 'down_5x'] },
  'switch': { name: 'switch', effectParameter: 8, scene: ['up_1x', 'up_2x', 'up_3x', 'up_4x', 'up_5x', 'down_1x', 'down_2x', 'down_3x', 'down_4x', 'down_5x'] },
  'fan': { name: 'fan', effectParameter: 16, scene: ['light_up_1x', 'light_up_2x', 'light_up_3x', 'light_up_4x', 'light_up_5x', 'light_down_1x', 'light_down_2x', 'light_down_3x', 'light_down_4x', 'light_down_5x', 'fan_up_1x', 'fan_up_2x', 'fan_up_3x', 'fan_down_1x', 'fan_down_2x', 'fan_down_3x'] }
};

const EFFECTS = {
  'lzw31-sn': { off: 0, solid: 1, chase: 2, 'fast blink': 3, 'slow blink': 4, pulse: 5 },
  'lzw36': { off: 0, solid: 1, chase: 2, 'fast blink': 3, 'slow blink': 4, pulse: 5 },
  'lzw30-sn': { off: 0, solid: 1, chase: 2, 'fast blink': 3, 'slow blink': 4, pulse: 5 },
  'lzw45': { off: 0, solid: 1, chase: 2, 'fast blink': 3, 'slow blink': 4, pulse: 5 }
};

const PARAMETERS = {
  'lzw31-sn': { notificationColor: 16, notificationDuration: 17, notificationEffect: 18, notificationBrightness: 19, ledColor:  leds(13), brightnessOn: 14, brightnessOff: 15 },
  'lzw30-sn': { notificationColor: 8, notificationDuration: 9, notificationEffect: 10, notificationBrightness: 11, ledColor: leds(5), brightnessOn: 6, brightnessOff: 7 },
  'lzw36': { notificationColor: 16, notificationDuration: 17, notificationEffect: 18, notificationBrightness: 19, ledColor: 13, brightnessOn: 14, brightnessOff: 15, fanColor: 20, fanBrightness: 21, fanBrightnessOff: 22 },
  'lzw45': { notificationColor: 8, notificationDuration: 9, notificationEffect: 10, notificationBrightness: 11, ledColor: leds(5), brightnessOn: 6, brightnessOff: 7 }
};
function leds(value) { return value; }

const ALIASES = {
  'lzw31-sn': 'lzw31-sn', lzw31sn: 'lzw31-sn', 'lzw31-sn dimmer': 'lzw31-sn', 'red dimmer': 'lzw31-sn',
  'lzw30-sn': 'lzw30-sn', lzw30sn: 'lzw30-sn', 'red switch': 'lzw30-sn',
  lzw36: 'lzw36', 'lzw-36': 'lzw36', 'red fan': 'lzw36',
  lzw45: 'lzw45', 'lzw45-s': 'lzw45', 'red button': 'lzw45',
  dimmer: 'dimmer', switch: 'switch', fan: 'fan'
};

function resolveSwitchType(value) {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 255) return { key: String(value), name: String(value), effectParameter: value, scene: [] };
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) return resolveSwitchType(Number(value));
  const key = ALIASES[String(value || '').trim().toLowerCase()];
  if (!key) throw new TypeError('Unknown switch type: ' + value);
  return Object.assign({ key }, SWITCHES[key]);
}

function parseHue(value) {
  let hue;
  if (typeof value === 'number' && Number.isFinite(value)) hue = value;
  else if (Array.isArray(value) && value.length >= 3) hue = convert.rgb.hsl(value.slice(0, 3).map(Number))[0];
  else if (typeof value === 'string') {
    const input = value.trim();
    if (/^#?[\da-f]{3,8}$/i.test(input) && input.replace('#', '').length !== 4) hue = convert.hex.hsl(input.replace(/^#/, ''))[0];
    else if (/^\d+(\.\d+)?$/.test(input)) hue = Number(input);
    else hue = convert.keyword.hsl(input.toLowerCase())[0];
  }
  if (!Number.isFinite(hue) || hue < 0 || hue > 361) throw new TypeError('Color must be a hue (0-361), RGB array, CSS color name, or hex string');
  return Math.round(Math.min(hue, 360) * 255 / 360);
}

function parseDuration(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.min(255, Math.max(1, Math.round(value)));
  let encoded;
  if (typeof value === 'string') {
    const text = value.trim().toLowerCase();
    const match = text.match(/^([0-9]+(?:\.[0-9]+)?)\s*(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d)?$/);
    if (!match) throw new TypeError('Invalid duration: ' + value);
    const amount = Number(match[1]);
    const unit = (match[2] || 'seconds').charAt(0);
    if (unit === 's') encoded = amount <= 60 ? amount : 60 + Math.ceil(amount / 60);
    else if (unit === 'm') encoded = 60 + amount;
    else if (unit === 'h') encoded = 120 + amount;
    else encoded = 120 + amount * 24;
  } else throw new TypeError('Invalid duration: ' + value);
  return Math.min(255, Math.max(1, Math.round(encoded)));
}

function integrationId(integration, entityId, nodeId) {
  const type = String(integration || 'zwave_js').toLowerCase();
  const id = type === 'zwave_js' ? entityId : nodeId;
  const key = type === 'zwave_js' ? 'entity_id' : 'node_id';
  const value = typeof id === 'string' && id.includes(',') ? id.split(',').map(item => item.trim()).filter(Boolean) : id;
  return { [key]: value };
}

function serviceMessage(integration, ids, parameter, value, multicast) {
  const zwave = String(integration || 'zwave_js').toLowerCase();
  const domain = zwave === 'zwave_js' ? 'zwave_js' : 'zwave';
  const service = zwave === 'zwave_js' ? 'set_config_parameter' : 'set_config_parameter';
  const data = Object.assign({}, ids, { parameter, value });
  if (multicast && zwave === 'zwave_js') data.multicast = true;
  return { payload: { domain, service, data } };
}

module.exports = { SWITCHES, EFFECTS, PARAMETERS, resolveSwitchType, parseHue, parseDuration, integrationId, serviceMessage };
