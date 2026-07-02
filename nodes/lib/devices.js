"use strict";

// ---------- Effect enums (name -> wire value) ----------
const EFFECTS_21_ALL = {
  off: 0, solid: 1, fast_blink: 2, slow_blink: 3, pulse: 4, chase: 5,
  open_close: 6, small_to_big: 7, aurora: 8, slow_falling: 9,
  medium_falling: 10, fast_falling: 11, slow_rising: 12, medium_rising: 13,
  fast_rising: 14, medium_blink: 15, slow_chase: 16, fast_chase: 17,
  fast_siren: 18, slow_siren: 19, clear_effect: 255,
};
const EFFECTS_21_INDIVIDUAL = {
  off: 0, solid: 1, fast_blink: 2, slow_blink: 3, pulse: 4, chase: 5,
  falling: 6, rising: 7, aurora: 8, clear_effect: 255,
};
const EFFECTS_LZW_SWITCH = { off: 0, solid: 1, fast_blink: 2, slow_blink: 3, pulse: 4 };
const EFFECTS_LZW_DIMMER = { off: 0, solid: 1, chase: 2, fast_blink: 3, slow_blink: 4, pulse: 5 };

// ---------- Scene event translation tables ----------
const ZWAVE_PROPERTY_KEY_TO_BUTTON = { "001": "down", "002": "up", "003": "config" };
const ZWAVE_VALUE_RAW_TO_TAP = {
  0: "single", 1: "release", 2: "held", 3: "double",
  4: "triple", 5: "quadruple", 6: "quintuple",
};
const ZHA_BUTTON = { button_1: "down", button_2: "up", button_3: "config" };
const ZHA_PRESS_TO_TAP = {
  press: "single", release: "release", hold: "held", double: "double",
  triple: "triple", quadruple: "quadruple", quintuple: "quintuple",
};
const MATTER_EVENT_TO_TAP = {
  multi_press_1: "single", multi_press_2: "double", multi_press_3: "triple",
  multi_press_4: "quadruple", multi_press_5: "quintuple",
  long_press: "held", long_release: "release",
};

// ---------- Legacy scene maps ----------
// LEGACY_SCENE_MAPS.LZW30/LZW31/LZW36/LZW45: copy the four map objects VERBATIM
// from nodes/inovelli-scene-manager.js lines 63–322 (LZW30Map, LZW31Map,
// LZW36Map, LZW45Map) — do not retype them.
const LEGACY_SCENE_MAPS = {
  LZW30: {
    0: {
      button: 2,
      scene: 0,
    },
    1: {
      button: 2,
      scene: 3,
    },
    2: {
      button: 2,
      scene: 4,
    },
    3: {
      button: 2,
      scene: 5,
    },
    4: {
      button: 2,
      scene: 6,
    },
    5: {
      button: 2,
      scene: 2,
    },
    6: {
      button: 2,
      scene: 1,
    },
    7: {
      button: 1,
      scene: 0,
    },
    8: {
      button: 1,
      scene: 3,
    },
    9: {
      button: 1,
      scene: 4,
    },
    10: {
      button: 1,
      scene: 5,
    },
    11: {
      button: 1,
      scene: 6,
    },
    12: {
      button: 1,
      scene: 2,
    },
    13: {
      button: 1,
      scene: 1,
    },
    14: {
      button: 3,
      scene: 0,
    },
  },
  LZW31: {
    0: {
      button: 2,
      scene: 0,
    },
    1: {
      button: 2,
      scene: 3,
    },
    2: {
      button: 2,
      scene: 4,
    },
    3: {
      button: 2,
      scene: 5,
    },
    4: {
      button: 2,
      scene: 6,
    },
    5: {
      button: 2,
      scene: 2,
    },
    6: {
      button: 2,
      scene: 1,
    },
    7: {
      button: 1,
      scene: 0,
    },
    8: {
      button: 1,
      scene: 3,
    },
    9: {
      button: 1,
      scene: 4,
    },
    10: {
      button: 1,
      scene: 5,
    },
    11: {
      button: 1,
      scene: 6,
    },
    12: {
      button: 1,
      scene: 2,
    },
    13: {
      button: 1,
      scene: 1,
    },
    14: {
      button: 3,
      scene: 0,
    },
  },
  LZW36: {
    0: {
      button: 2,
      scene: 0,
    },
    1: {
      button: 2,
      scene: 3,
    },
    2: {
      button: 2,
      scene: 4,
    },
    3: {
      button: 2,
      scene: 5,
    },
    4: {
      button: 2,
      scene: 6,
    },
    5: {
      button: 2,
      scene: 2,
    },
    6: {
      button: 2,
      scene: 1,
    },
    7: {
      button: 3,
      scene: 0,
    },
    8: {
      button: 4,
      scene: 0,
    },
    9: {
      button: 1,
      scene: 0,
    },
    10: {
      button: 1,
      scene: 3,
    },
    11: {
      button: 1,
      scene: 4,
    },
    12: {
      button: 1,
      scene: 5,
    },
    13: {
      button: 1,
      scene: 6,
    },
    14: {
      button: 1,
      scene: 2,
    },
    15: {
      button: 1,
      scene: 1,
    },
    16: {
      button: 5,
      scene: 0,
    },
    17: {
      button: 6,
      scene: 0,
    },
  },
  LZW45: {
    0: {
      button: 2,
      scene: 1,
    },
    1: {
      button: 2,
      scene: 4,
    },
    2: {
      button: 2,
      scene: 5,
    },
    3: {
      button: 2,
      scene: 6,
    },
    4: {
      button: 2,
      scene: 7,
    },
    5: {
      button: 2,
      scene: 2,
    },
    6: {
      button: 2,
      scene: 3,
    },
    7: {
      button: 1,
      scene: 1,
    },
    8: {
      button: 1,
      scene: 4,
    },
    9: {
      button: 1,
      scene: 5,
    },
    10: {
      button: 1,
      scene: 6,
    },
    11: {
      button: 1,
      scene: 7,
    },
    12: {
      button: 1,
      scene: 2,
    },
    13: {
      button: 1,
      scene: 3,
    },
    14: {
      button: 3,
      scene: 1,
    },
  },
};

// ---------- Registry ----------
const ZIGBEE_LEDBAR_ATTRS = {
  colorOn: { attribute: 95, property: "ledColorWhenOn" },
  colorOff: { attribute: 96, property: "ledColorWhenOff" },
  brightnessOn: { attribute: 97, property: "ledIntensityWhenOn" },
  brightnessOff: { attribute: 98, property: "ledIntensityWhenOff" },
};

const DEVICES = {
  // ----- Legacy Gen-2 Z-Wave -----
  "lzw30-sn": {
    label: "LZW30-SN On/Off (Red)",
    protocols: ["zwave_js"], generation: "lzw", levelMax: 10,
    notification: { all: [8] },
    effects: { all: EFFECTS_LZW_SWITCH },
    ledBar: { main: { color: 5, brightnessOn: 6, brightnessOff: 7 } },
    scenes: { legacyMap: "LZW30" },
  },
  "lzw31-sn": {
    label: "LZW31-SN Dimmer (Red)",
    protocols: ["zwave_js"], generation: "lzw", levelMax: 10,
    notification: { all: [16] },
    effects: { all: EFFECTS_LZW_DIMMER },
    ledBar: { main: { color: 13, brightnessOn: 14, brightnessOff: 15 } },
    scenes: { legacyMap: "LZW31" },
  },
  "lzw36": {
    label: "LZW36 Fan + Light (Red)",
    protocols: ["zwave_js"], generation: "lzw", levelMax: 10,
    notification: { all: [24, 25], main: [24], fan: [25] },
    effects: { all: EFFECTS_LZW_DIMMER },
    ledBar: {
      main: { color: 18, brightnessOn: 19, brightnessOff: 22 },
      fan: { color: 20, brightnessOn: 21, brightnessOff: 23 },
    },
    scenes: { legacyMap: "LZW36" },
  },
  "lzw45": {
    label: "LZW45 Light Strip (Red)",
    protocols: ["zwave_js"], generation: "lzw", levelMax: 10,
    scenes: { legacyMap: "LZW45" },
  },
  // ----- Red Series 2-1 (Z-Wave 800) -----
  "vzw31-sn": {
    label: "VZW31-SN 2-1 (Red)",
    protocols: ["zwave_js"], generation: "vzw", levelMax: 100,
    notification: { all: [99], individual: [64, 69, 74, 79, 84, 89, 94] },
    effects: { all: EFFECTS_21_ALL, individual: EFFECTS_21_INDIVIDUAL },
    ledBar: { main: { color: 95, colorOff: 96, brightnessOn: 97, brightnessOff: 98 } },
    scenes: { zwave21: true },
  },
  "vzw32-sn": {
    label: "VZW32-SN mmWave 2-1 (Red)",
    protocols: ["zwave_js"], generation: "vzw", levelMax: 100,
    notification: { all: [99], individual: [64, 69, 74, 79, 84, 89, 94] },
    effects: { all: EFFECTS_21_ALL, individual: EFFECTS_21_INDIVIDUAL },
    ledBar: { main: { color: 95, colorOff: 96, brightnessOn: 97, brightnessOff: 98 } },
    scenes: { zwave21: true },
  },
  // ----- Blue Series (Zigbee) -----
  "vzm31-sn": {
    label: "VZM31-SN 2-1 (Blue)",
    protocols: ["zigbee2mqtt", "zha"], generation: "vzm", levelMax: 100,
    notification: { zigbee: { endpoint: 1 } },
    effects: { all: EFFECTS_21_ALL, individual: EFFECTS_21_INDIVIDUAL },
    ledBar: { main: { endpoint: 1, suffix: "", attrs: ZIGBEE_LEDBAR_ATTRS } },
    scenes: { zigbee: true },
  },
  "vzm32-sn": {
    label: "VZM32-SN mmWave 2-1 (Blue)",
    protocols: ["zigbee2mqtt", "zha"], generation: "vzm", levelMax: 100,
    notification: { zigbee: { endpoint: 1 } },
    effects: { all: EFFECTS_21_ALL, individual: EFFECTS_21_INDIVIDUAL },
    ledBar: { main: { endpoint: 1, suffix: "", attrs: ZIGBEE_LEDBAR_ATTRS } },
    scenes: { zigbee: true },
  },
  "vzm35-sn": {
    label: "VZM35-SN Fan Switch (Blue)",
    protocols: ["zigbee2mqtt", "zha"], generation: "vzm", levelMax: 100,
    notification: { zigbee: { endpoint: 1 } },
    effects: { all: EFFECTS_21_ALL, individual: EFFECTS_21_INDIVIDUAL },
    ledBar: { main: { endpoint: 1, suffix: "", attrs: ZIGBEE_LEDBAR_ATTRS } },
    scenes: { zigbee: true },
  },
  "vzm36": {
    label: "VZM36 Fan + Light Canopy (Blue)",
    protocols: ["zigbee2mqtt", "zha"], generation: "vzm", levelMax: 100,
    // No LED bar effects or buttons: persistent config only.
    ledBar: {
      main: { endpoint: 1, suffix: "_1", attrs: ZIGBEE_LEDBAR_ATTRS },
      fan: { endpoint: 2, suffix: "_2", attrs: ZIGBEE_LEDBAR_ATTRS },
    },
  },
  // ----- White Series (Matter) -----
  "vtm31-sn": {
    label: "VTM31-SN 2-1 (White)",
    protocols: ["matter"], generation: "vtm", levelMax: 100,
    notification: { matter: true },
    ledBar: { matter: true },
    scenes: { matter: true },
  },
  "vtm35-sn": {
    label: "VTM35-SN Fan Switch (White)",
    protocols: ["matter"], generation: "vtm", levelMax: 100,
    notification: { matter: true },
    ledBar: { matter: true },
    scenes: { matter: true },
  },
};

// ---------- Aliases ----------
// Keys are lowercased strings; numeric switchtypes from BOTH legacy nodes are
// included (notification manager used 8/16/24/25/49, led manager used 5/13/18/20/38).
const ALIASES = {
  // legacy names
  "switch": ["lzw30-sn", "all"], "on/off": ["lzw30-sn", "all"], "lzw30": ["lzw30-sn", "all"],
  "dimmer": ["lzw31-sn", "all"], "lzw31": ["lzw31-sn", "all"],
  "combo_light": ["lzw36", "main"], "lzw36_light": ["lzw36", "main"],
  "combo_fan": ["lzw36", "fan"], "lzw36_fan": ["lzw36", "fan"], "fan": ["lzw36", "fan"],
  "fan and light": ["lzw36", "all"], "light and fan": ["lzw36", "all"],
  // legacy numeric switchtypes
  "8": ["lzw30-sn", "all"], "16": ["lzw31-sn", "all"], "24": ["lzw36", "main"],
  "25": ["lzw36", "fan"], "49": ["lzw36", "all"],
  "5": ["lzw30-sn", "all"], "13": ["lzw31-sn", "all"], "18": ["lzw36", "main"],
  "20": ["lzw36", "fan"], "38": ["lzw36", "all"],
  // friendly 2-1 names
  "blue 2-1": ["vzm31-sn", "all"], "red 2-1": ["vzw31-sn", "all"],
  "blue fan": ["vzm35-sn", "all"], "blue canopy": ["vzm36", "all"],
  "white 2-1": ["vtm31-sn", "all"], "white fan": ["vtm35-sn", "all"],
};

function resolve(input) {
  const key = String(input).trim().toLowerCase();
  if (DEVICES[key]) return { id: key, device: DEVICES[key], section: "all" };
  if (ALIASES[key]) {
    const [id, section] = ALIASES[key];
    return { id, device: DEVICES[id], section };
  }
  throw new Error(`Unknown Inovelli model: ${input}`);
}

function effectFor(device, scope, input) {
  const table = device.effects && device.effects[scope];
  if (!table) throw new Error(`Device has no ${scope} effects`);
  if (typeof input === "number" || /^\d+$/.test(String(input).trim())) {
    const id = parseInt(input, 10);
    const name = Object.keys(table).find((k) => table[k] === id);
    if (name === undefined) throw new Error(`Invalid effect ${input} for scope ${scope}`);
    return { id, name };
  }
  const name = String(input).trim().toLowerCase().replace(/[\s/-]+/g, "_");
  if (table[name] === undefined) {
    throw new Error(`Invalid effect "${input}" for scope ${scope}. Valid: ${Object.keys(table).join(", ")}`);
  }
  return { id: table[name], name };
}

module.exports = {
  DEVICES, LEGACY_SCENE_MAPS, resolve, effectFor,
  ZWAVE_PROPERTY_KEY_TO_BUTTON, ZWAVE_VALUE_RAW_TO_TAP,
  ZHA_BUTTON, ZHA_PRESS_TO_TAP, MATTER_EVENT_TO_TAP,
};
