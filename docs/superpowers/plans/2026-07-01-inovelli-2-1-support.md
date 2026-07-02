# Inovelli 2-1 Device Generation Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Modernize the three Inovelli Node-RED nodes to support Blue (Zigbee), Red 2-1 (Z-Wave 800), White (Matter), and legacy LZW devices, emitting modern HA Action-node messages, published as npm package `node-red-contrib-ha-inovelli` v1.0.0.

**Architecture:** A declarative device registry (`nodes/lib/devices.js`) plus pure converters (`nodes/lib/convert.js`) and four per-protocol encoders (`nodes/lib/encoders/*.js`) that produce `{payload: {action, target, data}}` messages. The three node files become thin consumers. Spec: `docs/superpowers/specs/2026-07-01-inovelli-2-1-device-support-design.md`.

**Tech Stack:** Node.js (CommonJS), Node-RED node API (1.0+ `send`/`done`), `color-convert`, `mocha` + `node-red-node-test-helper`.

## Global Constraints

- Package name `node-red-contrib-ha-inovelli`, version `1.0.0`, MIT, node-red keyword retained.
- Node type names unchanged: `inovelli-notification-manager`, `inovelli-led-manager`, `inovelli-scene-manager`.
- Runtime dependency limited to `color-convert` (existing).
- Output format is Action-node only: `msg.payload = { action, target?, data }`. Never emit `domain`/`service`.
- Integrations: `zwave_js`, `zigbee2mqtt`, `zha`, `matter`. OZW/legacy-zwave code must not survive.
- Levels are native ranges: 0–10 for `lzw` generation, 0–100 for `vzw`/`vzm`/`vtm`.
- All input validation errors go through `done(err)`; no silent fallbacks.
- Every task: tests first (mocha), then implementation, then commit.
- Verified wire facts (byte layouts, parameter numbers, enums) are in the spec §3; do not "correct" them from memory.

## Key wire facts (from spec — single source of truth for all tasks)

- **VZW pack (Red 2-1, params 99 / 64,69,74,79,84,89,94):** `value = effect*16777216 + color*65536 + level*256 + duration`
- **LZW pack (legacy, params 8/16/24/25):** `value = color + level*256 + duration*65536 + effect*16777216`; clear value is `65536`
- **VZW clear:** write `0` to the parameter. **Zigbee clear:** effect `clear_effect` (255).
- **Duration byte:** 1–60 s; 61–120 = minutes+60; 121–254 = hours+120; 255 indefinite; 0 = off/clear (legacy semantics)
- **Color byte:** 0–255 hue; 255 = white. LZW scale `hslHue*17/24`; 2-1 scale `hslHue*254/360`.
- **Zigbee cluster:** 64561 (0xFC31), endpoint 1, manufacturer 4655, command 1 = all-LED, 3 = individual; ZHA `led_number` is 0-based; Z2M `led` is string `"1"`–`"7"`.
- **Zigbee persistent attrs:** 95 colorOn, 96 colorOff, 97 intensityOn, 98 intensityOff (same numbers as VZW Z-Wave params).
- **Effect enums:** see Task 4 registry code (2-1 all: off…slow_siren=0–19, clear_effect=255; 2-1 individual: off…aurora=0–8 with 6=falling/7=rising, clear_effect=255).

---

### Task 1: Package identity and test harness

**Files:**
- Modify: `package.json`
- Create: `test/smoke_spec.js`

**Interfaces:**
- Produces: `npm test` runs mocha against `test/**/*_spec.js`; all later tasks rely on this.

- [ ] **Step 1: Update package.json**

Replace the entire `package.json` with:

```json
{
  "name": "node-red-contrib-ha-inovelli",
  "version": "1.0.0",
  "repository": {
    "type": "git",
    "url": "https://github.com/zpearce-2814/node-red-contrib-ha-inovelli-manager.git"
  },
  "description": "Nodes for managing LED notifications, LED bar settings, and multi-tap scenes on Inovelli switches (Blue/Red/White/legacy) through Home Assistant",
  "keywords": [
    "inovelli",
    "node-red",
    "home assistant",
    "zigbee2mqtt",
    "zha",
    "zwave-js",
    "matter",
    "notification",
    "scene control"
  ],
  "scripts": {
    "test": "mocha \"test/**/*_spec.js\""
  },
  "node-red": {
    "nodes": {
      "inovelli-notification-manager": "nodes/inovelli-notification-manager.js",
      "inovelli-led-manager": "nodes/inovelli-led-manager.js",
      "inovelli-scene-manager": "nodes/inovelli-scene-manager.js"
    }
  },
  "author": "Zack Pearce",
  "license": "MIT",
  "devDependencies": {
    "mocha": "^10.4.0",
    "node-red": "^3.1.0",
    "node-red-node-test-helper": "^0.3.4"
  },
  "dependencies": {
    "color-convert": "^2.0.1"
  }
}
```

Note: `color-convert` v2 renamed nothing we use (`hex.rgb`, `keyword.rgb`, `hsv.rgb`, `rgb.hsl` all unchanged).

- [ ] **Step 2: Write smoke test**

`test/smoke_spec.js`:

```js
const assert = require("assert");

describe("test harness", function () {
  it("runs", function () {
    assert.strictEqual(1 + 1, 2);
  });
});
```

- [ ] **Step 3: Install and run**

Run: `npm install && npm test`
Expected: `1 passing`

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json test/smoke_spec.js
git commit -m "chore: rename package to node-red-contrib-ha-inovelli v1.0.0, add test harness"
```

---

### Task 2: Color, duration, and level converters

**Files:**
- Create: `nodes/lib/convert.js`
- Test: `test/convert_spec.js`

**Interfaces:**
- Produces:
  - `toHue(color, generation) -> number 0-255` — `color`: keyword string | `"#rrggbb"` | `[r,g,b]` | number 0–361 (361=white); `generation`: `"lzw" | "vzw" | "vzm" | "vtm"`. Throws `Error` on invalid input.
  - `toDuration(input) -> number 0-255` — `input`: number/numeric string 0–255, or `"N seconds|minutes|hours|days"`, `"forever" | "indefinite" | "indefinitely"`, `"off" | "disable"`. Throws on invalid.
  - `toLevel(input, max) -> number` — integer 0–max. Throws on invalid.

- [ ] **Step 1: Write failing tests**

`test/convert_spec.js`:

```js
const assert = require("assert");
const { toHue, toDuration, toLevel } = require("../nodes/lib/convert");

describe("toHue", function () {
  it("converts keywords for 2-1 generation (254/360 scale)", function () {
    assert.strictEqual(toHue("red", "vzw"), 0);
    assert.strictEqual(toHue("blue", "vzw"), Math.round(240 * (254 / 360))); // 169
  });
  it("converts keywords for legacy generation (17/24 scale)", function () {
    assert.strictEqual(toHue("blue", "lzw"), Math.round(240 * (17 / 24))); // 170
  });
  it("accepts hex, RGB array, and hue number", function () {
    assert.strictEqual(toHue("#ff0000", "vzw"), 0);
    assert.strictEqual(toHue([0, 0, 255], "vzw"), 169);
    assert.strictEqual(toHue(240, "vzw"), 169);
  });
  it("maps greys and 361 to white (255)", function () {
    assert.strictEqual(toHue([200, 200, 200], "vzw"), 255);
    assert.strictEqual(toHue(361, "lzw"), 255);
    assert.strictEqual(toHue("white", "vzm"), 255);
  });
  it("throws on invalid input", function () {
    assert.throws(() => toHue(-1, "vzw"));
    assert.throws(() => toHue([300, 0, 0], "vzw"));
    assert.throws(() => toHue("notacolor", "vzw"));
    assert.throws(() => toHue({}, "vzw"));
  });
});

describe("toDuration", function () {
  it("passes through raw bytes", function () {
    assert.strictEqual(toDuration(10), 10);
    assert.strictEqual(toDuration("255"), 255);
  });
  it("encodes unit strings", function () {
    assert.strictEqual(toDuration("30 seconds"), 30);
    assert.strictEqual(toDuration("1 minute"), 61);
    assert.strictEqual(toDuration("60 minutes"), 120);
    assert.strictEqual(toDuration("1 hour"), 121);
    assert.strictEqual(toDuration("134 hours"), 254);
    assert.strictEqual(toDuration("2 days"), 168);
    assert.strictEqual(toDuration("forever"), 255);
    assert.strictEqual(toDuration("off"), 0);
  });
  it("throws on invalid values", function () {
    assert.throws(() => toDuration(256));
    assert.throws(() => toDuration(-1));
    assert.throws(() => toDuration("135 hours"));
    assert.throws(() => toDuration("6 days"));
    assert.throws(() => toDuration("soon"));
  });
});

describe("toLevel", function () {
  it("validates against the device max", function () {
    assert.strictEqual(toLevel(10, 10), 10);
    assert.strictEqual(toLevel("55", 100), 55);
    assert.throws(() => toLevel(11, 10));
    assert.throws(() => toLevel(-1, 100));
    assert.throws(() => toLevel("high", 100));
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test`
Expected: FAIL — `Cannot find module '../nodes/lib/convert'`

- [ ] **Step 3: Implement**

`nodes/lib/convert.js`:

```js
"use strict";
const convert = require("color-convert");

const WHITE = 255;

function toHue(color, generation) {
  let rgb;
  if (Array.isArray(color)) {
    if (color.length !== 3 || color.some((c) => typeof c !== "number" || c < 0 || c > 255)) {
      throw new Error(`Invalid RGB array: ${JSON.stringify(color)}`);
    }
    rgb = color;
  } else if (typeof color === "string" && color.startsWith("#")) {
    rgb = convert.hex.rgb(color);
  } else if (typeof color === "string") {
    rgb = convert.keyword.rgb(color.replace(/\s/g, "").toLowerCase());
    if (!rgb) throw new Error(`Unknown color name: ${color}`);
  } else if (typeof color === "number") {
    if (color < 0 || color > 361) throw new Error(`Hue out of range 0-361: ${color}`);
    if (color === 361) return WHITE;
    rgb = convert.hsv.rgb([color, 100, 100]);
  } else {
    throw new Error(`Unsupported color value: ${JSON.stringify(color)}`);
  }
  if (rgb[0] === rgb[1] && rgb[1] === rgb[2]) return WHITE;
  const hslHue = convert.rgb.hsl(rgb)[0];
  const scale = generation === "lzw" ? 17 / 24 : 254 / 360;
  return Math.round(hslHue * scale);
}

function toDuration(input) {
  if (typeof input === "number" || /^\d+$/.test(String(input).trim())) {
    const n = parseInt(input, 10);
    if (n < 0 || n > 255) throw new Error(`Duration byte out of range 0-255: ${input}`);
    return n;
  }
  const value = parseInt(input, 10);
  const unit = String(input).replace(/^[\s\d]+/, "").trim().toLowerCase();
  if (["second", "seconds"].includes(unit) && value >= 1 && value <= 60) return value;
  if (["minute", "minutes"].includes(unit) && value >= 1 && value <= 60) return value + 60;
  if (["hour", "hours"].includes(unit) && value >= 1 && value <= 134) return value + 120;
  if (["day", "days"].includes(unit) && value >= 1 && value <= 5) return value * 24 + 120;
  if (["forever", "indefinite", "indefinitely"].includes(unit)) return 255;
  if (["off", "disable"].includes(unit)) return 0;
  throw new Error(`Unrecognized duration: ${input}`);
}

function toLevel(input, max) {
  const n = parseInt(input, 10);
  if (isNaN(n) || n < 0 || n > max) {
    throw new Error(`Level out of range 0-${max}: ${input}`);
  }
  return n;
}

module.exports = { toHue, toDuration, toLevel, WHITE };
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: PASS (all convert tests + smoke)

- [ ] **Step 5: Commit**

```bash
git add nodes/lib/convert.js test/convert_spec.js
git commit -m "feat: shared color/duration/level converters"
```

---

### Task 3: Matter helpers (color snap, brightness snap, duration-to-ms)

**Files:**
- Modify: `nodes/lib/convert.js`
- Test: `test/convert_matter_spec.js`

**Interfaces:**
- Produces:
  - `snapToMatterColor(color) -> string` — one of the 13 White Series select options: `Red, Orange, Lemon, Lime, Green, Teal, Cyan, Aqua, Blue, Violet, Magenta, Pink, White`. Input: any `toHue`-compatible color value.
  - `snapToMatterBrightness(pct) -> number` — nearest of `[0,1,3,5,8,10,13,16,20,23,26,30,33,36,40,45,50,60,70,80,90,100]`.
  - `durationToMs(byte) -> number|null` — milliseconds for a finite duration byte; `null` for 0 or 255.
  - `hueToRgb(hueByte) -> [r,g,b]` — inverse of the 2-1 hue byte for `light.turn_on` rgb_color (255 -> `[255,255,255]`).

- [ ] **Step 1: Write failing tests**

`test/convert_matter_spec.js`:

```js
const assert = require("assert");
const {
  snapToMatterColor,
  snapToMatterBrightness,
  durationToMs,
  hueToRgb,
} = require("../nodes/lib/convert");

describe("snapToMatterColor", function () {
  it("snaps to the nearest named color by hue", function () {
    assert.strictEqual(snapToMatterColor("red"), "Red");
    assert.strictEqual(snapToMatterColor("#0000ff"), "Blue");
    assert.strictEqual(snapToMatterColor(35), "Orange");
    assert.strictEqual(snapToMatterColor([255, 255, 255]), "White");
    assert.strictEqual(snapToMatterColor(361), "White");
  });
});

describe("snapToMatterBrightness", function () {
  it("snaps to supported steps", function () {
    assert.strictEqual(snapToMatterBrightness(100), 100);
    assert.strictEqual(snapToMatterBrightness(2), 1);
    assert.strictEqual(snapToMatterBrightness(2.1), 3);
    assert.strictEqual(snapToMatterBrightness(64), 60);
    assert.strictEqual(snapToMatterBrightness(66), 70);
  });
});

describe("durationToMs", function () {
  it("converts finite bytes and nulls infinite/off", function () {
    assert.strictEqual(durationToMs(10), 10000);
    assert.strictEqual(durationToMs(61), 60000);
    assert.strictEqual(durationToMs(121), 3600000);
    assert.strictEqual(durationToMs(255), null);
    assert.strictEqual(durationToMs(0), null);
  });
});

describe("hueToRgb", function () {
  it("round-trips device hue bytes", function () {
    assert.deepStrictEqual(hueToRgb(255), [255, 255, 255]);
    assert.deepStrictEqual(hueToRgb(0), [255, 0, 0]);
    assert.deepStrictEqual(hueToRgb(169), [0, 4, 255]); // 169*360/254 ≈ 239.5°
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test`
Expected: FAIL — snapToMatterColor is not a function

- [ ] **Step 3: Implement (append to `nodes/lib/convert.js` before `module.exports`)**

```js
// White Series (Matter) LED Color select options with canonical hue positions (degrees).
const MATTER_COLORS = [
  ["Red", 0], ["Orange", 30], ["Lemon", 50], ["Lime", 90], ["Green", 120],
  ["Teal", 165], ["Cyan", 180], ["Aqua", 210], ["Blue", 240], ["Violet", 270],
  ["Magenta", 300], ["Pink", 330],
];
const MATTER_BRIGHTNESS_STEPS = [0, 1, 3, 5, 8, 10, 13, 16, 20, 23, 26, 30, 33, 36, 40, 45, 50, 60, 70, 80, 90, 100];

function snapToMatterColor(color) {
  const hueByte = toHue(color, "vtm");
  if (hueByte === WHITE) return "White";
  const deg = (hueByte * 360) / 254;
  let best = MATTER_COLORS[0][0];
  let bestDist = Infinity;
  for (const [name, h] of MATTER_COLORS) {
    const d = Math.min(Math.abs(deg - h), 360 - Math.abs(deg - h));
    if (d < bestDist) {
      bestDist = d;
      best = name;
    }
  }
  return best;
}

function snapToMatterBrightness(pct) {
  let best = MATTER_BRIGHTNESS_STEPS[0];
  for (const step of MATTER_BRIGHTNESS_STEPS) {
    if (Math.abs(pct - step) < Math.abs(pct - best)) best = step;
  }
  return best;
}

function durationToMs(byte) {
  if (byte <= 0 || byte >= 255) return null;
  if (byte <= 60) return byte * 1000;
  if (byte <= 120) return (byte - 60) * 60000;
  return (byte - 120) * 3600000;
}

function hueToRgb(hueByte) {
  if (hueByte === WHITE) return [255, 255, 255];
  return convert.hsv.rgb([(hueByte * 360) / 254, 100, 100]);
}
```

Add `snapToMatterColor, snapToMatterBrightness, durationToMs, hueToRgb` to `module.exports`.

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: PASS. If the `hueToRgb(169)` assertion fails on an off-by-one channel value, update the expected array to the actual `color-convert` output — the test pins behavior, the exact rounding is not contractual.

- [ ] **Step 5: Commit**

```bash
git add nodes/lib/convert.js test/convert_matter_spec.js
git commit -m "feat: Matter color/brightness snapping and duration-to-ms helpers"
```

---

### Task 4: Device registry

**Files:**
- Create: `nodes/lib/devices.js`
- Test: `test/devices_spec.js`
- Reference: `nodes/inovelli-scene-manager.js:63-322` (legacy scene maps to copy verbatim)

**Interfaces:**
- Produces:
  - `resolve(input) -> { id, device, section }` — `input`: model string/alias/legacy numeric switchtype. `section` is `"all" | "main" | "fan"` (LZW36/VZM36 addressing; `"all"` means both for LZW36). Throws on unknown model.
  - `effectFor(device, scope, input) -> { id, name }` — `scope`: `"all" | "individual"`; `input`: effect name (case/space-insensitive) or integer. Throws if invalid for that device/scope.
  - `DEVICES` — registry object (shape below).
  - `LEGACY_SCENE_MAPS` — `{ LZW30, LZW31, LZW36, LZW45 }` copied verbatim from the current scene manager.
  - Scene translation tables: `ZWAVE_PROPERTY_KEY_TO_BUTTON`, `ZWAVE_VALUE_RAW_TO_TAP`, `ZHA_BUTTON`, `ZHA_PRESS_TO_TAP`, `MATTER_EVENT_TO_TAP`.

- [ ] **Step 1: Write failing tests**

`test/devices_spec.js`:

```js
const assert = require("assert");
const d = require("../nodes/lib/devices");

describe("resolve", function () {
  it("resolves canonical ids", function () {
    assert.strictEqual(d.resolve("vzw31-sn").id, "vzw31-sn");
    assert.strictEqual(d.resolve("VZM31-SN").id, "vzm31-sn");
  });
  it("resolves legacy aliases and numeric switchtypes", function () {
    assert.strictEqual(d.resolve("dimmer").id, "lzw31-sn");
    assert.strictEqual(d.resolve(8).id, "lzw30-sn");
    assert.strictEqual(d.resolve(16).id, "lzw31-sn");
    const fan = d.resolve(25);
    assert.strictEqual(fan.id, "lzw36");
    assert.strictEqual(fan.section, "fan");
    assert.strictEqual(d.resolve(49).section, "all");
    assert.strictEqual(d.resolve(5).id, "lzw30-sn"); // led-manager legacy value
    assert.strictEqual(d.resolve("blue 2-1").id, "vzm31-sn");
    assert.strictEqual(d.resolve("red 2-1").id, "vzw31-sn");
  });
  it("throws on unknown models", function () {
    assert.throws(() => d.resolve("toaster"));
  });
});

describe("registry data", function () {
  it("VZW31-SN has 2-1 Z-Wave notification params", function () {
    const { device } = d.resolve("vzw31-sn");
    assert.deepStrictEqual(device.notification.all, [99]);
    assert.deepStrictEqual(device.notification.individual, [64, 69, 74, 79, 84, 89, 94]);
    assert.strictEqual(device.levelMax, 100);
    assert.strictEqual(device.generation, "vzw");
  });
  it("legacy devices keep their params and 0-10 levels", function () {
    const { device } = d.resolve("lzw31-sn");
    assert.deepStrictEqual(device.notification.all, [16]);
    assert.strictEqual(device.levelMax, 10);
    assert.deepStrictEqual(device.ledBar.main, { color: 13, brightnessOn: 14, brightnessOff: 15 });
  });
  it("LZW36 sections address light and fan params", function () {
    const { device } = d.resolve("lzw36");
    assert.deepStrictEqual(device.notification.all, [24, 25]);
    assert.deepStrictEqual(device.notification.main, [24]);
    assert.deepStrictEqual(device.notification.fan, [25]);
    assert.deepStrictEqual(device.ledBar.fan, { color: 20, brightnessOn: 21, brightnessOff: 23 });
  });
  it("VZM36 is config-only with endpoint sections", function () {
    const { device } = d.resolve("vzm36");
    assert.strictEqual(device.notification, undefined);
    assert.strictEqual(device.scenes, undefined);
    assert.strictEqual(device.ledBar.main.endpoint, 1);
    assert.strictEqual(device.ledBar.fan.endpoint, 2);
    assert.strictEqual(device.ledBar.main.suffix, "_1");
  });
});

describe("effectFor", function () {
  it("maps 2-1 names and ints for both scopes", function () {
    const { device } = d.resolve("vzw31-sn");
    assert.deepStrictEqual(d.effectFor(device, "all", "aurora"), { id: 8, name: "aurora" });
    assert.deepStrictEqual(d.effectFor(device, "all", "Slow Siren"), { id: 19, name: "slow_siren" });
    assert.deepStrictEqual(d.effectFor(device, "all", 17), { id: 17, name: "fast_chase" });
    assert.deepStrictEqual(d.effectFor(device, "individual", "falling"), { id: 6, name: "falling" });
    assert.deepStrictEqual(d.effectFor(device, "individual", 255), { id: 255, name: "clear_effect" });
  });
  it("rejects effects invalid for scope or device", function () {
    const vzw = d.resolve("vzw31-sn").device;
    assert.throws(() => d.effectFor(vzw, "individual", "slow_siren"));
    const lzw30 = d.resolve("lzw30-sn").device;
    assert.throws(() => d.effectFor(lzw30, "all", "chase"));
    assert.deepStrictEqual(d.effectFor(lzw30, "all", "pulse"), { id: 4, name: "pulse" });
    const lzw31 = d.resolve("lzw31-sn").device;
    assert.deepStrictEqual(d.effectFor(lzw31, "all", "chase"), { id: 2, name: "chase" });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test`
Expected: FAIL — `Cannot find module '../nodes/lib/devices'`

- [ ] **Step 3: Implement**

`nodes/lib/devices.js`:

```js
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
// from nodes/inovelli-scene-manager.js lines 63-322 (LZW30Map, LZW31Map,
// LZW36Map, LZW45Map) — do not retype them.
const LEGACY_SCENE_MAPS = {
  LZW30: { /* verbatim copy */ },
  LZW31: { /* verbatim copy */ },
  LZW36: { /* verbatim copy */ },
  LZW45: { /* verbatim copy */ },
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
```

Then replace the four `{ /* verbatim copy */ }` placeholders with the literal object bodies of `LZW30Map`, `LZW31Map`, `LZW36Map`, `LZW45Map` from `nodes/inovelli-scene-manager.js` lines 63–322 (they are plain `{0: {button, scene}, ...}` objects).

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add nodes/lib/devices.js test/devices_spec.js
git commit -m "feat: declarative device registry for all Inovelli generations"
```

---

### Task 5: Z-Wave JS encoder

**Files:**
- Create: `nodes/lib/encoders/zwavejs.js`
- Test: `test/encoder_zwavejs_spec.js`

**Interfaces:**
- Consumes: `resolve()` results from Task 4 (`{ device, section }`).
- Produces:
  - `notification(resolved, fields, target) -> msg[]` — `resolved`: `{device, section}`; `fields`: `{ led: "all"|1-7, effectId, color, level, duration, clear, multicast }`; `target`: `{ entity_id?: string[], device_id?: string[], area_id?: string[] }`. Each msg is `{ payload: { action, target, data } }`.
  - `ledBar(resolved, section, fields, target) -> msg[]` — `section`: `"main"|"fan"`; `fields`: subset of `{ color, colorOff, brightnessOn, brightnessOff }` (only set keys are emitted).

- [ ] **Step 1: Write failing tests**

`test/encoder_zwavejs_spec.js`:

```js
const assert = require("assert");
const enc = require("../nodes/lib/encoders/zwavejs");
const { resolve } = require("../nodes/lib/devices");

const target = { entity_id: ["light.office"] };

describe("zwavejs notification", function () {
  it("packs the VZW 2-1 layout (worked example from Inovelli forum)", function () {
    // Chase(5), violet(190), 10%, 10s -> 96340490
    const msgs = enc.notification(resolve("vzw31-sn"), {
      led: "all", effectId: 5, color: 190, level: 10, duration: 10,
      clear: false, multicast: false,
    }, target);
    assert.strictEqual(msgs.length, 1);
    assert.deepStrictEqual(msgs[0].payload, {
      action: "zwave_js.bulk_set_partial_config_parameters",
      target,
      data: { parameter: 99, value: 96340490 },
    });
  });
  it("uses individual LED params (LED1=64 ... LED7=94)", function () {
    const msgs = enc.notification(resolve("vzw31-sn"), {
      led: 3, effectId: 4, color: 0, level: 50, duration: 255,
      clear: false, multicast: false,
    }, target);
    assert.strictEqual(msgs[0].payload.data.parameter, 74);
    assert.strictEqual(msgs[0].payload.data.value, 4 * 16777216 + 0 * 65536 + 50 * 256 + 255);
  });
  it("clears VZW with value 0", function () {
    const msgs = enc.notification(resolve("vzw31-sn"), {
      led: "all", effectId: 1, color: 0, level: 0, duration: 0,
      clear: true, multicast: false,
    }, target);
    assert.strictEqual(msgs[0].payload.data.value, 0);
  });
  it("packs the legacy LZW layout and clear value 65536", function () {
    // Legacy: color + level*256 + duration*65536 + effect*16777216
    const msgs = enc.notification(resolve("lzw31-sn"), {
      led: "all", effectId: 3, color: 170, level: 10, duration: 60,
      clear: false, multicast: false,
    }, target);
    assert.strictEqual(msgs[0].payload.data.parameter, 16);
    assert.strictEqual(msgs[0].payload.data.value, 170 + 10 * 256 + 60 * 65536 + 3 * 16777216);
    const cleared = enc.notification(resolve("lzw31-sn"), {
      led: "all", effectId: 3, color: 170, level: 10, duration: 60,
      clear: true, multicast: false,
    }, target);
    assert.strictEqual(cleared[0].payload.data.value, 65536);
  });
  it("legacy clear also triggers on effect 0 or duration 0", function () {
    const byEffect = enc.notification(resolve("lzw31-sn"), {
      led: "all", effectId: 0, color: 1, level: 1, duration: 1, clear: false, multicast: false,
    }, target);
    assert.strictEqual(byEffect[0].payload.data.value, 65536);
  });
  it("emits both LZW36 params for section all", function () {
    const msgs = enc.notification(resolve(49), {
      led: "all", effectId: 1, color: 0, level: 5, duration: 255, clear: false, multicast: false,
    }, target);
    assert.deepStrictEqual(msgs.map((m) => m.payload.data.parameter), [24, 25]);
  });
  it("emits multicast_set_value when multicast", function () {
    const msgs = enc.notification(resolve("vzw31-sn"), {
      led: "all", effectId: 1, color: 0, level: 100, duration: 255, clear: false, multicast: true,
    }, target);
    assert.strictEqual(msgs[0].payload.action, "zwave_js.multicast_set_value");
    assert.deepStrictEqual(msgs[0].payload.data, {
      command_class: 112,
      property: 99,
      value: 1 * 16777216 + 0 * 65536 + 100 * 256 + 255,
    });
  });
  it("rejects individual LEDs on devices without them", function () {
    assert.throws(() => enc.notification(resolve("lzw31-sn"), {
      led: 2, effectId: 1, color: 0, level: 5, duration: 10, clear: false, multicast: false,
    }, target));
  });
});

describe("zwavejs ledBar", function () {
  it("emits one set_config_parameter per set field (VZW)", function () {
    const msgs = enc.ledBar(resolve("vzw31-sn"), "main", { color: 170, brightnessOff: 5 }, target);
    assert.deepStrictEqual(msgs.map((m) => m.payload.data), [
      { parameter: 95, value: 170 },
      { parameter: 98, value: 5 },
    ]);
    assert.strictEqual(msgs[0].payload.action, "zwave_js.set_config_parameter");
  });
  it("emits legacy LZW36 fan params", function () {
    const msgs = enc.ledBar(resolve("lzw36"), "fan", { color: 0, brightnessOn: 7 }, target);
    assert.deepStrictEqual(msgs.map((m) => m.payload.data), [
      { parameter: 20, value: 0 },
      { parameter: 21, value: 7 },
    ]);
  });
  it("rejects colorOff on devices without a when-off color", function () {
    assert.throws(() => enc.ledBar(resolve("lzw31-sn"), "main", { colorOff: 170 }, target));
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test`
Expected: FAIL — cannot find module encoders/zwavejs

- [ ] **Step 3: Implement**

`nodes/lib/encoders/zwavejs.js`:

```js
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
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add nodes/lib/encoders/zwavejs.js test/encoder_zwavejs_spec.js
git commit -m "feat: Z-Wave JS encoder with VZW/LZW packing and multicast"
```

---

### Task 6: Zigbee2MQTT encoder

**Files:**
- Create: `nodes/lib/encoders/zigbee2mqtt.js`
- Test: `test/encoder_z2m_spec.js`

**Interfaces:**
- Consumes: Task 4 `resolve()`; Task 4 registry `ledBar.main.suffix` / `ledBar.fan.suffix`.
- Produces:
  - `notification(resolved, fields, target) -> msg[]` — `fields`: `{ led: "all"|1-7, effectName, color, level, duration, clear }`; `target`: `{ baseTopic, name }`. Emits one `mqtt.publish` action; `data.payload` is a JSON **string**.
  - `ledBar(resolved, section, fields, target) -> msg[]` — one publish combining all set fields (property names suffixed for VZM36).

- [ ] **Step 1: Write failing tests**

`test/encoder_z2m_spec.js`:

```js
const assert = require("assert");
const enc = require("../nodes/lib/encoders/zigbee2mqtt");
const { resolve } = require("../nodes/lib/devices");

const target = { baseTopic: "zigbee2mqtt", name: "Office Switch" };

describe("zigbee2mqtt notification", function () {
  it("publishes led_effect for all LEDs", function () {
    const msgs = enc.notification(resolve("vzm31-sn"), {
      led: "all", effectName: "fast_blink", color: 170, level: 100, duration: 60, clear: false,
    }, target);
    assert.strictEqual(msgs.length, 1);
    assert.strictEqual(msgs[0].payload.action, "mqtt.publish");
    assert.strictEqual(msgs[0].payload.data.topic, "zigbee2mqtt/Office Switch/set");
    assert.deepStrictEqual(JSON.parse(msgs[0].payload.data.payload), {
      led_effect: { effect: "fast_blink", color: 170, level: 100, duration: 60 },
    });
  });
  it("publishes individual_led_effect with string led 1-7", function () {
    const msgs = enc.notification(resolve("vzm31-sn"), {
      led: 7, effectName: "pulse", color: 0, level: 80, duration: 255, clear: false,
    }, target);
    assert.deepStrictEqual(JSON.parse(msgs[0].payload.data.payload), {
      individual_led_effect: { led: "7", effect: "pulse", color: 0, level: 80, duration: 255 },
    });
  });
  it("clears with clear_effect", function () {
    const msgs = enc.notification(resolve("vzm31-sn"), {
      led: "all", effectName: "solid", color: 0, level: 100, duration: 255, clear: true,
    }, target);
    assert.strictEqual(JSON.parse(msgs[0].payload.data.payload).led_effect.effect, "clear_effect");
  });
  it("rejects notification on VZM36", function () {
    assert.throws(() => enc.notification(resolve("vzm36"), {
      led: "all", effectName: "solid", color: 0, level: 100, duration: 255, clear: false,
    }, target));
  });
});

describe("zigbee2mqtt ledBar", function () {
  it("publishes set properties in one message", function () {
    const msgs = enc.ledBar(resolve("vzm31-sn"), "main", { color: 170, brightnessOn: 33 }, target);
    assert.strictEqual(msgs.length, 1);
    assert.deepStrictEqual(JSON.parse(msgs[0].payload.data.payload), {
      ledColorWhenOn: 170,
      ledIntensityWhenOn: 33,
    });
  });
  it("suffixes VZM36 fan properties", function () {
    const msgs = enc.ledBar(resolve("vzm36"), "fan", { colorOff: 0, brightnessOff: 1 }, target);
    assert.deepStrictEqual(JSON.parse(msgs[0].payload.data.payload), {
      ledColorWhenOff_2: 0,
      ledIntensityWhenOff_2: 1,
    });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test`
Expected: FAIL — cannot find module

- [ ] **Step 3: Implement**

`nodes/lib/encoders/zigbee2mqtt.js`:

```js
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
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add nodes/lib/encoders/zigbee2mqtt.js test/encoder_z2m_spec.js
git commit -m "feat: Zigbee2MQTT encoder for led_effect and persistent LED settings"
```

---

### Task 7: ZHA encoder

**Files:**
- Create: `nodes/lib/encoders/zha.js`
- Test: `test/encoder_zha_spec.js`

**Interfaces:**
- Consumes: Task 4 `resolve()`; registry `ledBar.<section>.endpoint` and `attrs`.
- Produces:
  - `notification(resolved, fields, target) -> msg[]` — `fields` as Task 6 plus `effectId` (int); `target`: `{ ieee }`. Emits `zha.issue_zigbee_cluster_command` with `params` dict (`led_number` 0-based for individual).
  - `ledBar(resolved, section, fields, target) -> msg[]` — one `zha.set_zigbee_cluster_attribute` per set field.

- [ ] **Step 1: Write failing tests**

`test/encoder_zha_spec.js`:

```js
const assert = require("assert");
const enc = require("../nodes/lib/encoders/zha");
const { resolve } = require("../nodes/lib/devices");

const target = { ieee: "00:0d:6f:00:0a:bb:cc:dd" };

describe("zha notification", function () {
  it("issues command 1 for all LEDs", function () {
    const msgs = enc.notification(resolve("vzm31-sn"), {
      led: "all", effectId: 1, color: 170, level: 100, duration: 255, clear: false,
    }, target);
    assert.strictEqual(msgs.length, 1);
    assert.strictEqual(msgs[0].payload.action, "zha.issue_zigbee_cluster_command");
    assert.deepStrictEqual(msgs[0].payload.data, {
      ieee: target.ieee,
      endpoint_id: 1,
      cluster_id: 64561,
      cluster_type: "in",
      command: 1,
      command_type: "server",
      manufacturer: 4655,
      params: { led_effect: 1, led_color: 170, led_level: 100, led_duration: 255 },
    });
  });
  it("issues command 3 with 0-based led_number for individual", function () {
    const msgs = enc.notification(resolve("vzm31-sn"), {
      led: 7, effectId: 4, color: 0, level: 80, duration: 10, clear: false,
    }, target);
    assert.strictEqual(msgs[0].payload.data.command, 3);
    assert.strictEqual(msgs[0].payload.data.params.led_number, 6);
  });
  it("clears with effect 255", function () {
    const msgs = enc.notification(resolve("vzm31-sn"), {
      led: "all", effectId: 1, color: 0, level: 100, duration: 255, clear: true,
    }, target);
    assert.strictEqual(msgs[0].payload.data.params.led_effect, 255);
  });
});

describe("zha ledBar", function () {
  it("writes one attribute per set field", function () {
    const msgs = enc.ledBar(resolve("vzm31-sn"), "main", { color: 170, brightnessOff: 5 }, target);
    assert.deepStrictEqual(msgs.map((m) => m.payload.data), [
      { ieee: target.ieee, endpoint_id: 1, cluster_id: 64561, cluster_type: "in", attribute: 95, value: 170, manufacturer: 4655 },
      { ieee: target.ieee, endpoint_id: 1, cluster_id: 64561, cluster_type: "in", attribute: 98, value: 5, manufacturer: 4655 },
    ]);
    assert.strictEqual(msgs[0].payload.action, "zha.set_zigbee_cluster_attribute");
  });
  it("targets endpoint 2 for VZM36 fan settings", function () {
    const msgs = enc.ledBar(resolve("vzm36"), "fan", { brightnessOn: 40 }, target);
    assert.strictEqual(msgs[0].payload.data.endpoint_id, 2);
    assert.strictEqual(msgs[0].payload.data.attribute, 97);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test`
Expected: FAIL — cannot find module

- [ ] **Step 3: Implement**

`nodes/lib/encoders/zha.js`:

```js
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
  // Field order in `data` matters for the deepStrictEqual test: build in the
  // documented order ieee, endpoint_id, cluster_id, cluster_type, command,
  // command_type, manufacturer, params.
  const ordered = {
    ieee: data.ieee, endpoint_id: data.endpoint_id, cluster_id: data.cluster_id,
    cluster_type: data.cluster_type, command: data.command, command_type: data.command_type,
    manufacturer: data.manufacturer, params: data.params,
  };
  return [{ payload: { action: "zha.issue_zigbee_cluster_command", data: ordered } }];
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
```

Note: `deepStrictEqual` does not compare key order — the "ordered" comment is documentation only; if you prefer, build `data` directly in one literal.

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add nodes/lib/encoders/zha.js test/encoder_zha_spec.js
git commit -m "feat: ZHA encoder for cluster commands and attribute writes"
```

---

### Task 8: Matter encoder

**Files:**
- Create: `nodes/lib/encoders/matter.js`
- Test: `test/encoder_matter_spec.js`

**Interfaces:**
- Consumes: Task 3 helpers (`snapToMatterColor`, `snapToMatterBrightness`, `durationToMs`, `hueToRgb`).
- Produces:
  - `notification(resolved, fields, entities) -> { messages: msg[], clearAfterMs: number|null, clearMessages: msg[] }` — `fields`: `{ effectName (option string, e.g. "Solid"/"Blink"/"Chase"/"Siren"), rawColor (unconverted user color), level (0-100), duration (byte), clear }`; `entities`: `{ light, effectSelect, colorSelect }` (entity_id strings; `light` required for Solid/clear, selects required for animated effects).
  - `ledBar(resolved, fields, entities) -> msg[]` — `fields`: `{ rawColor?, brightnessOn?, brightnessOff? }`; `entities`: `{ colorSelect?, intensityOn?, intensityOff? }` (`number.*` entity ids).

- [ ] **Step 1: Write failing tests**

`test/encoder_matter_spec.js`:

```js
const assert = require("assert");
const enc = require("../nodes/lib/encoders/matter");
const { resolve } = require("../nodes/lib/devices");

const entities = {
  light: "light.office_rgb_indicator",
  effectSelect: "select.office_led_effect",
  colorSelect: "select.office_led_color",
};

describe("matter notification", function () {
  it("uses light.turn_on for Solid", function () {
    const r = enc.notification(resolve("vtm31-sn"), {
      effectName: "Solid", rawColor: "red", level: 50, duration: 10, clear: false,
    }, entities);
    assert.strictEqual(r.messages.length, 1);
    assert.deepStrictEqual(r.messages[0].payload, {
      action: "light.turn_on",
      target: { entity_id: ["light.office_rgb_indicator"] },
      data: { rgb_color: [255, 0, 0], brightness_pct: 50 },
    });
    assert.strictEqual(r.clearAfterMs, 10000);
    assert.strictEqual(r.clearMessages.length, 2);
  });
  it("uses selects for animated effects", function () {
    const r = enc.notification(resolve("vtm31-sn"), {
      effectName: "Chase", rawColor: "#0000ff", level: 64, duration: 255, clear: false,
    }, entities);
    assert.deepStrictEqual(r.messages[0].payload, {
      action: "select.select_option",
      target: { entity_id: ["select.office_led_color"] },
      data: { option: "Blue" },
    });
    assert.deepStrictEqual(r.messages[1].payload, {
      action: "select.select_option",
      target: { entity_id: ["select.office_led_effect"] },
      data: { option: "Chase" },
    });
    assert.strictEqual(r.clearAfterMs, null);
  });
  it("clear sends light.turn_off and effect Off", function () {
    const r = enc.notification(resolve("vtm31-sn"), {
      effectName: "Solid", rawColor: "red", level: 50, duration: 255, clear: true,
    }, entities);
    assert.strictEqual(r.messages[0].payload.action, "light.turn_off");
    assert.deepStrictEqual(r.messages[1].payload.data, { option: "Off" });
    assert.strictEqual(r.clearAfterMs, null);
  });
});

describe("matter ledBar", function () {
  it("sets color select and intensity numbers", function () {
    const msgs = enc.ledBar(resolve("vtm31-sn"), {
      rawColor: "cyan", brightnessOn: 34, brightnessOff: 2,
    }, {
      colorSelect: "select.office_led_color",
      intensityOn: "number.office_led_intensity_on",
      intensityOff: "number.office_led_intensity_off",
    });
    assert.deepStrictEqual(msgs.map((m) => m.payload.action), [
      "select.select_option", "number.set_value", "number.set_value",
    ]);
    assert.deepStrictEqual(msgs[1].payload.data, { value: 33 }); // snapped
    assert.deepStrictEqual(msgs[2].payload.data, { value: 1 });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test`
Expected: FAIL — cannot find module

- [ ] **Step 3: Implement**

`nodes/lib/encoders/matter.js`:

```js
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
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add nodes/lib/encoders/matter.js test/encoder_matter_spec.js
git commit -m "feat: Matter encoder composing light/select/number actions"
```

---

### Task 9: Notification manager node (runtime)

**Files:**
- Modify: `nodes/inovelli-notification-manager.js` (full rewrite)
- Test: `test/notification_node_spec.js`

**Interfaces:**
- Consumes: `resolve`, `effectFor` (Task 4); `toHue`, `toDuration`, `toLevel` (Task 2); all four encoders (Tasks 5–8).
- Produces: Node type `inovelli-notification-manager` with config properties:
  `name, integration, model, entityid, basetopic, devicename, ieee, matterlight, mattereffect, mattercolor, color, level, duration, effect, led, clear, multicast`.
  Payload overrides: `integration` (alias `zwave`), `model` (alias `switchtype`), `entity_id`, `topic`, `device`, `ieee`, `light_entity`, `effect_entity`, `color_entity`, `color`, `level` (alias `brightness`), `duration`, `effect`, `led`, `clear`, `multicast`.

- [ ] **Step 1: Write failing tests**

`test/notification_node_spec.js`:

```js
const assert = require("assert");
const helper = require("node-red-node-test-helper");
const notifNode = require("../nodes/inovelli-notification-manager.js");

helper.init(require.resolve("node-red"));

function flowFor(cfg) {
  return [
    { id: "n1", type: "inovelli-notification-manager", wires: [["h"]], ...cfg },
    { id: "h", type: "helper" },
  ];
}

describe("inovelli-notification-manager", function () {
  afterEach(function () { return helper.unload(); });

  it("emits a zwave_js bulk_set message", function (done) {
    // Config color is a hue DEGREE (0-361); 0 = red = device byte 0, so the
    // packed value is deterministic: chase(5)<<24 | 0<<16 | 10<<8 | 10.
    const flow = flowFor({
      integration: "zwave_js", model: "vzw31-sn", entityid: "light.office",
      color: "0", level: "10", duration: "10", effect: "chase", led: "all",
      clear: false, multicast: false,
    });
    helper.load(notifNode, flow, function () {
      helper.getNode("h").on("input", function (msg) {
        try {
          assert.strictEqual(msg.payload.action, "zwave_js.bulk_set_partial_config_parameters");
          assert.deepStrictEqual(msg.payload.target, { entity_id: ["light.office"] });
          assert.deepStrictEqual(msg.payload.data, { parameter: 99, value: 5 * 16777216 + 10 * 256 + 10 });
          done();
        } catch (e) { done(e); }
      });
      helper.getNode("n1").receive({ payload: {} });
    });
  });

  it("payload overrides win and accept friendly formats", function (done) {
    const flow = flowFor({
      integration: "zwave_js", model: "vzw31-sn", entityid: "light.office",
      color: "0", level: "100", duration: "255", effect: "solid", led: "all",
      clear: false, multicast: false,
    });
    helper.load(notifNode, flow, function () {
      helper.getNode("h").on("input", function (msg) {
        try {
          // pulse(4)<<24 | red(0)<<16 | 50<<8 | "30 seconds"(30)
          assert.deepStrictEqual(msg.payload.data, { parameter: 99, value: 4 * 16777216 + 50 * 256 + 30 });
          done();
        } catch (e) { done(e); }
      });
      helper.getNode("n1").receive({
        payload: { effect: "Pulse", color: "red", level: 50, duration: "30 seconds" },
      });
    });
  });

  it("emits mqtt.publish for zigbee2mqtt", function (done) {
    const flow = flowFor({
      integration: "zigbee2mqtt", model: "vzm31-sn", basetopic: "zigbee2mqtt",
      devicename: "Office Switch", color: "240", level: "100", duration: "255",
      effect: "aurora", led: "all", clear: false, multicast: false,
    });
    helper.load(notifNode, flow, function () {
      helper.getNode("h").on("input", function (msg) {
        try {
          assert.strictEqual(msg.payload.action, "mqtt.publish");
          assert.strictEqual(msg.payload.data.topic, "zigbee2mqtt/Office Switch/set");
          const body = JSON.parse(msg.payload.data.payload);
          // 240 degrees (blue) -> round(240 * 254/360) = 169
          assert.deepStrictEqual(body.led_effect, { effect: "aurora", color: 169, level: 100, duration: 255 });
          done();
        } catch (e) { done(e); }
      });
      helper.getNode("n1").receive({ payload: {} });
    });
  });

  it("emits zha cluster command for individual LED", function (done) {
    const flow = flowFor({
      integration: "zha", model: "vzm31-sn", ieee: "00:0d:6f:00:0a:bb:cc:dd",
      color: "0", level: "80", duration: "10", effect: "pulse", led: "7",
      clear: false, multicast: false,
    });
    helper.load(notifNode, flow, function () {
      helper.getNode("h").on("input", function (msg) {
        try {
          assert.strictEqual(msg.payload.action, "zha.issue_zigbee_cluster_command");
          assert.strictEqual(msg.payload.data.command, 3);
          assert.strictEqual(msg.payload.data.params.led_number, 6);
          done();
        } catch (e) { done(e); }
      });
      helper.getNode("n1").receive({ payload: {} });
    });
  });

  it("emits the matter sequence for animated effects", function (done) {
    const flow = flowFor({
      integration: "matter", model: "vtm31-sn",
      matterlight: "light.office_rgb", mattereffect: "select.office_led_effect",
      mattercolor: "select.office_led_color",
      color: "240", level: "100", duration: "255", effect: "Chase", led: "all",
      clear: false, multicast: false,
    });
    helper.load(notifNode, flow, function () {
      const seen = [];
      helper.getNode("h").on("input", function (msg) {
        seen.push(msg.payload);
        if (seen.length === 2) {
          try {
            assert.deepStrictEqual(seen[0].data, { option: "Blue" });
            assert.deepStrictEqual(seen[1].data, { option: "Chase" });
            done();
          } catch (e) { done(e); }
        }
      });
      helper.getNode("n1").receive({ payload: {} });
    });
  });

  it("reports invalid input through done/error", function (done) {
    const flow = flowFor({
      integration: "zwave_js", model: "vzw31-sn", entityid: "light.office",
      color: "0", level: "100", duration: "255", effect: "solid", led: "all",
      clear: false, multicast: false,
    });
    helper.load(notifNode, flow, function () {
      const n1 = helper.getNode("n1");
      n1.on("call:error", () => {});
      n1.receive({ payload: { effect: "sparkle" } });
      setTimeout(function () {
        // No output should have been produced
        done();
      }, 50);
    });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test`
Expected: FAIL (old node still expects `zwave`/`switchtype` config; new tests error)

- [ ] **Step 3: Rewrite the node**

`nodes/inovelli-notification-manager.js` (replace entire file):

```js
module.exports = function (RED) {
  const devices = require("./lib/devices");
  const convert = require("./lib/convert");
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
  function numeric(v) {
    return typeof v === "string" && /^\d+$/.test(v.trim()) ? parseInt(v, 10) : v;
  }
  function entityList(v) {
    return String(v).split(",").map((s) => s.trim()).filter(Boolean);
  }

  function InovelliNotificationManager(config) {
    RED.nodes.createNode(this, config);
    const node = this;
    node._clearTimer = null;

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
          if (node._clearTimer) clearTimeout(node._clearTimer);
          if (result.clearAfterMs && result.clearMessages.length) {
            node._clearTimer = setTimeout(() => send([result.clearMessages]), result.clearAfterMs);
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
      if (node._clearTimer) clearTimeout(node._clearTimer);
    });
  }
  RED.nodes.registerType("inovelli-notification-manager", InovelliNotificationManager);
};
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add nodes/inovelli-notification-manager.js test/notification_node_spec.js
git commit -m "feat: notification manager supports all four integrations"
```

---

### Task 10: Notification manager editor UI

**Files:**
- Modify: `nodes/inovelli-notification-manager.html` (full rewrite)

**Interfaces:**
- Consumes: config property names from Task 9 (`integration, model, entityid, basetopic, devicename, ieee, matterlight, mattereffect, mattercolor, color, level, duration, effect, led, clear, multicast`).

- [ ] **Step 1: Rewrite the editor file**

Replace `nodes/inovelli-notification-manager.html` entirely. Keep the existing `<style>` block (lines 100–157 of the current file) verbatim inside the template. Structure:

```html
<script type="text/javascript">
  (function () {
    // Kept in sync with nodes/lib/devices.js — editor cannot require() it.
    const MODELS = {
      zwave_js: [
        ["vzw31-sn", "VZW31-SN 2-1 (Red)"], ["vzw32-sn", "VZW32-SN mmWave (Red)"],
        ["lzw30-sn", "LZW30-SN On/Off (Red)"], ["lzw31-sn", "LZW31-SN Dimmer (Red)"],
        ["lzw36", "LZW36 Fan + Light (Red)"],
      ],
      zigbee2mqtt: [
        ["vzm31-sn", "VZM31-SN 2-1 (Blue)"], ["vzm32-sn", "VZM32-SN mmWave (Blue)"],
        ["vzm35-sn", "VZM35-SN Fan (Blue)"],
      ],
      zha: [
        ["vzm31-sn", "VZM31-SN 2-1 (Blue)"], ["vzm32-sn", "VZM32-SN mmWave (Blue)"],
        ["vzm35-sn", "VZM35-SN Fan (Blue)"],
      ],
      matter: [
        ["vtm31-sn", "VTM31-SN 2-1 (White)"], ["vtm35-sn", "VTM35-SN Fan (White)"],
      ],
    };
    const EFFECTS_21_ALL = ["off", "solid", "fast_blink", "slow_blink", "pulse", "chase",
      "open_close", "small_to_big", "aurora", "slow_falling", "medium_falling", "fast_falling",
      "slow_rising", "medium_rising", "fast_rising", "medium_blink", "slow_chase", "fast_chase",
      "fast_siren", "slow_siren"];
    const EFFECTS_21_INDIVIDUAL = ["off", "solid", "fast_blink", "slow_blink", "pulse", "chase",
      "falling", "rising", "aurora"];
    const EFFECTS_LZW_SWITCH = ["off", "solid", "fast_blink", "slow_blink", "pulse"];
    const EFFECTS_LZW_DIMMER = ["off", "solid", "chase", "fast_blink", "slow_blink", "pulse"];
    const EFFECTS_MATTER = ["Solid", "Blink", "Chase", "Siren"]; // free-text; device-defined options

    function effectsFor(model, led) {
      if (model.startsWith("vtm")) return EFFECTS_MATTER;
      if (model.startsWith("lzw")) return model === "lzw30-sn" ? EFFECTS_LZW_SWITCH : EFFECTS_LZW_DIMMER;
      return led === "all" ? EFFECTS_21_ALL : EFFECTS_21_INDIVIDUAL;
    }
    function pretty(name) {
      return name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    }

    RED.nodes.registerType("inovelli-notification-manager", {
      category: "inovelli",
      color: "#B68181",
      defaults: {
        name: { value: "" },
        integration: { value: "zwave_js" },
        model: { value: "vzw31-sn" },
        entityid: { value: "" },
        basetopic: { value: "zigbee2mqtt" },
        devicename: { value: "" },
        ieee: { value: "" },
        matterlight: { value: "" },
        mattereffect: { value: "" },
        mattercolor: { value: "" },
        color: { value: 0 },
        level: { value: 100 },
        duration: { value: 255 },
        effect: { value: "pulse" },
        led: { value: "all" },
        clear: { value: false },
        multicast: { value: false },
      },
      inputs: 1,
      outputs: 1,
      outputLabels: "Connect to a Home Assistant action node",
      icon: "light.svg",
      align: "right",
      label: function () { return this.name || "inovelli-notification-manager"; },
      oneditprepare: function () {
        const self = this;

        function refreshModels() {
          const integration = $("#node-input-integration").val();
          const $model = $("#node-input-model").empty();
          MODELS[integration].forEach(([id, label]) => $model.append(new Option(label, id)));
          $model.val(MODELS[integration].some(([id]) => id === self.model) ? self.model : MODELS[integration][0][0]);
          refreshVisibility();
          refreshEffects();
        }
        function refreshVisibility() {
          const integration = $("#node-input-integration").val();
          $(".row-zwave").toggle(integration === "zwave_js");
          $(".row-z2m").toggle(integration === "zigbee2mqtt");
          $(".row-zha").toggle(integration === "zha");
          $(".row-matter").toggle(integration === "matter");
          $(".row-led").toggle(integration !== "matter" && !$("#node-input-model").val().startsWith("lzw"));
        }
        function refreshEffects() {
          const model = $("#node-input-model").val();
          const led = $("#node-input-led").val() || "all";
          const $effect = $("#node-input-effect");
          const previous = $effect.val() || self.effect;
          $effect.empty();
          effectsFor(model, led).forEach((e) => $effect.append(new Option(pretty(e), e)));
          if ($effect.find(`option[value="${previous}"]`).length) $effect.val(previous);
          const max = model.startsWith("lzw") ? 10 : 100;
          $("#node-input-level").attr("max", max);
          $("#levelOutput").text($("#node-input-level").val());
        }

        $("#node-input-integration").on("change", refreshModels);
        $("#node-input-model").on("change", function () { refreshVisibility(); refreshEffects(); });
        $("#node-input-led").on("change", refreshEffects);
        $("#node-input-color").on("input change", function () { $("#colorOutput").text(this.value); });
        $("#node-input-level").on("input change", function () { $("#levelOutput").text(this.value); });
        $("#node-input-clear").on("change", function () {
          $(".row-notify").toggle(!$(this).is(":checked"));
        });
        refreshModels();
      },
    });
  })();
</script>
```

Template (`<script type="text/x-red" data-template-name="...">`): keep the existing style block, then form rows — each with the class used by `refreshVisibility`:

- Name (`node-input-name`, always)
- Integration select (`node-input-integration`, options: Z-Wave JS / Zigbee2MQTT / ZHA / Matter)
- Model select (`node-input-model`, populated by script)
- `row-zwave`: Entity ID(s) text (`node-input-entityid`); Use Multicast checkbox (`node-input-multicast`)
- `row-z2m`: Base Topic text (`node-input-basetopic`); Device Name text (`node-input-devicename`)
- `row-zha`: IEEE Address text (`node-input-ieee`)
- `row-matter`: LED Light Entity (`node-input-matterlight`); LED Effect Select Entity (`node-input-mattereffect`); LED Color Select Entity (`node-input-mattercolor`)
- `row-led row-notify`: LED select (`node-input-led`, options: All, LED 1 (Bottom) … LED 7 (Top), values `all`,`1`…`7`)
- `row-notify color-input`: color slider 0–361 (`node-input-color`, existing `.color-picker` styling + `colorOutput`)
- `row-notify`: Level slider 0–100 (`node-input-level`, `.brightness-picker` styling + `levelOutput`)
- `row-notify`: Duration select (`node-input-duration`) — copy the 26 `<option>` rows verbatim from the current file lines 205–230
- `row-notify`: Effect select (`node-input-effect`, populated by script)
- Clear Notification checkbox (`node-input-clear`)

Help block (`data-help-name`): rewrite describing all four integrations and the payload override keys from Task 9's interface list, including two payload examples (one zwave_js with `entity_id`, one zigbee2mqtt with `device`/`topic`).

- [ ] **Step 2: Verify tests still pass and the file parses**

Run: `npm test`
Expected: PASS (HTML has no runtime tests). Optionally `npx node-red -u /tmp/nr-test` and confirm the node renders with dropdowns switching correctly.

- [ ] **Step 3: Commit**

```bash
git add nodes/inovelli-notification-manager.html
git commit -m "feat: notification manager editor UI for all integrations"
```

---

### Task 11: LED manager node (runtime)

**Files:**
- Modify: `nodes/inovelli-led-manager.js` (full rewrite)
- Test: `test/led_node_spec.js`

**Interfaces:**
- Consumes: Tasks 2, 4–8 (`ledBar` encoders).
- Produces: Node type `inovelli-led-manager` with config:
  `name, integration, model, entityid, basetopic, devicename, ieee, mattercolor, matterintensityon, matterintensityoff, color, colorOff, brightness, brightnessOff, fanColor, fanBrightness, fanBrightnessOff, toggleColor, toggleColorOff, toggleBrightness, toggleBrightnessOff, toggleFanColor, toggleFanBrightness, toggleFanBrightnessOff`.
  Payload overrides: same targeting keys as Task 9 plus `color, colorOff, brightness, brightnessOff, fanColor, fanBrightness, fanBrightnessOff`.
  Semantics: a field is emitted iff its toggle is checked or the payload supplies it (existing behavior, extended with `colorOff`).

- [ ] **Step 1: Write failing tests**

`test/led_node_spec.js`:

```js
const assert = require("assert");
const helper = require("node-red-node-test-helper");
const ledNode = require("../nodes/inovelli-led-manager.js");

helper.init(require.resolve("node-red"));

describe("inovelli-led-manager", function () {
  afterEach(function () { return helper.unload(); });

  it("emits one zwave_js set_config_parameter per configured field (VZW)", function (done) {
    const flow = [
      { id: "n1", type: "inovelli-led-manager", wires: [["h"]],
        integration: "zwave_js", model: "vzw31-sn", entityid: "light.office",
        color: "170", brightnessOff: "5",
        toggleColor: true, toggleColorOff: false, toggleBrightness: false,
        toggleBrightnessOff: true, toggleFanColor: false, toggleFanBrightness: false,
        toggleFanBrightnessOff: false },
      { id: "h", type: "helper" },
    ];
    helper.load(ledNode, flow, function () {
      const seen = [];
      helper.getNode("h").on("input", function (msg) {
        seen.push(msg.payload.data);
        if (seen.length === 2) {
          try {
            assert.deepStrictEqual(seen, [
              { parameter: 95, value: 170 },
              { parameter: 98, value: 5 },
            ]);
            done();
          } catch (e) { done(e); }
        }
      });
      helper.getNode("n1").receive({ payload: {} });
    });
  });

  it("emits LZW36 fan settings via payload", function (done) {
    const flow = [
      { id: "n1", type: "inovelli-led-manager", wires: [["h"]],
        integration: "zwave_js", model: "lzw36", entityid: "fan.office",
        toggleColor: false, toggleColorOff: false, toggleBrightness: false,
        toggleBrightnessOff: false, toggleFanColor: false, toggleFanBrightness: false,
        toggleFanBrightnessOff: false },
      { id: "h", type: "helper" },
    ];
    helper.load(ledNode, flow, function () {
      helper.getNode("h").on("input", function (msg) {
        try {
          assert.deepStrictEqual(msg.payload.data, { parameter: 20, value: 0 });
          done();
        } catch (e) { done(e); }
      });
      helper.getNode("n1").receive({ payload: { fanColor: "red" } });
    });
  });

  it("emits a single Z2M publish combining fields", function (done) {
    const flow = [
      { id: "n1", type: "inovelli-led-manager", wires: [["h"]],
        integration: "zigbee2mqtt", model: "vzm31-sn", basetopic: "zigbee2mqtt",
        devicename: "Office Switch", color: "170", brightness: "33",
        toggleColor: true, toggleColorOff: false, toggleBrightness: true,
        toggleBrightnessOff: false, toggleFanColor: false, toggleFanBrightness: false,
        toggleFanBrightnessOff: false },
      { id: "h", type: "helper" },
    ];
    helper.load(ledNode, flow, function () {
      helper.getNode("h").on("input", function (msg) {
        try {
          assert.deepStrictEqual(JSON.parse(msg.payload.data.payload), {
            ledColorWhenOn: 170, ledIntensityWhenOn: 33,
          });
          done();
        } catch (e) { done(e); }
      });
      helper.getNode("n1").receive({ payload: {} });
    });
  });

  it("emits matter select and number calls", function (done) {
    const flow = [
      { id: "n1", type: "inovelli-led-manager", wires: [["h"]],
        integration: "matter", model: "vtm31-sn",
        mattercolor: "select.office_led_color",
        matterintensityon: "number.office_led_intensity_on",
        matterintensityoff: "number.office_led_intensity_off",
        color: "180", brightness: "34",
        toggleColor: true, toggleColorOff: false, toggleBrightness: true,
        toggleBrightnessOff: false, toggleFanColor: false, toggleFanBrightness: false,
        toggleFanBrightnessOff: false },
      { id: "h", type: "helper" },
    ];
    helper.load(ledNode, flow, function () {
      const seen = [];
      helper.getNode("h").on("input", function (msg) {
        seen.push(msg.payload);
        if (seen.length === 2) {
          try {
            assert.strictEqual(seen[0].action, "select.select_option");
            assert.deepStrictEqual(seen[1].data, { value: 33 });
            done();
          } catch (e) { done(e); }
        }
      });
      helper.getNode("n1").receive({ payload: {} });
    });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test`
Expected: FAIL

- [ ] **Step 3: Rewrite the node**

`nodes/inovelli-led-manager.js` (replace entire file):

```js
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
```

Note on the matter branch: the raw (unconverted) color is re-picked from payload/config because `snapToMatterColor` needs the original value, not the device hue byte.

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add nodes/inovelli-led-manager.js test/led_node_spec.js
git commit -m "feat: LED manager supports all four integrations"
```

---

### Task 12: LED manager editor UI

**Files:**
- Modify: `nodes/inovelli-led-manager.html` (full rewrite)

**Interfaces:**
- Consumes: config property names from Task 11.

- [ ] **Step 1: Rewrite the editor file**

Same pattern as Task 10 (reuse its `MODELS` table plus a `["vzm36", "VZM36 Canopy (Blue)"]` entry appended to the `zigbee2mqtt` and `zha` lists; keep the existing `<style>` block from the current file lines matching `.color-picker`/`.brightness-picker`). Defaults:

```js
defaults: {
  name: { value: "" },
  integration: { value: "zwave_js" },
  model: { value: "vzw31-sn" },
  entityid: { value: "" },
  basetopic: { value: "zigbee2mqtt" },
  devicename: { value: "" },
  ieee: { value: "" },
  mattercolor: { value: "" },
  matterintensityon: { value: "" },
  matterintensityoff: { value: "" },
  color: { value: 170 },
  colorOff: { value: 170 },
  brightness: { value: 33 },
  brightnessOff: { value: 1 },
  fanColor: { value: 170 },
  fanBrightness: { value: 33 },
  fanBrightnessOff: { value: 1 },
  toggleColor: { value: false },
  toggleColorOff: { value: false },
  toggleBrightness: { value: false },
  toggleBrightnessOff: { value: false },
  toggleFanColor: { value: false },
  toggleFanBrightness: { value: false },
  toggleFanBrightnessOff: { value: false },
},
```

Form rows: integration + model + per-integration target rows exactly as Task 10; then paired rows (checkbox toggle + slider) for: Color When On (`toggleColor`/`color`), Color When Off (`toggleColorOff`/`colorOff`, hidden unless model is `vzw*`/`vzm*` — legacy has one color, matter has none), Brightness When On, Brightness When Off, and the three Fan rows (visible only for `lzw36` and `vzm36`). Visibility logic in `oneditprepare`:

```js
function refreshRows() {
  const model = $("#node-input-model").val() || "";
  const integration = $("#node-input-integration").val();
  $(".row-coloroff").toggle(model.startsWith("vzw") || model.startsWith("vzm"));
  $(".row-fan").toggle(model === "lzw36" || model === "vzm36");
  $(".row-color").toggle(integration !== "matter" || true); // matter uses snapped color
  const max = model.startsWith("lzw") ? 10 : 100;
  $(".level-slider").attr("max", max);
}
```

Level sliders use max 10 for `lzw*`, 100 otherwise. Help block documents the toggle-or-payload emission rule and lists payload keys from Task 11.

- [ ] **Step 2: Verify**

Run: `npm test`
Expected: PASS (unchanged)

- [ ] **Step 3: Commit**

```bash
git add nodes/inovelli-led-manager.html
git commit -m "feat: LED manager editor UI for all integrations"
```

---

### Task 13: Scene manager node (runtime)

**Files:**
- Modify: `nodes/inovelli-scene-manager.js` (full rewrite)
- Test: `test/scene_node_spec.js`

**Interfaces:**
- Consumes: Task 4 registry (`scenes`, `LEGACY_SCENE_MAPS`, translation tables).
- Produces: Node type `inovelli-scene-manager` with config:
  `name, integration, model, idfilter, passthrough, outputs, mappings, matterup, matterdown, matterconfig`.
  - `mappings`: JSON string of `[{ "button": "up|down|config", "tap": "single|double|triple|quadruple|quintuple|held|release" }, ...]`, index = output (used for 2-1/Matter models).
  - Legacy models ignore `mappings` and use `LEGACY_SCENE_MAPS` + `outputs` exactly like the old node.
  - `idfilter`: comma list matched per source (zwave node ids; ZHA `device_ieee`; Z2M device name from topic; Matter: not used — the three entity configs identify the device).

- [ ] **Step 1: Write failing tests**

`test/scene_node_spec.js`:

```js
const assert = require("assert");
const helper = require("node-red-node-test-helper");
const sceneNode = require("../nodes/inovelli-scene-manager.js");

helper.init(require.resolve("node-red"));

const MAPPINGS = JSON.stringify([
  { button: "up", tap: "double" },
  { button: "config", tap: "single" },
]);

function flow21(extra) {
  return [
    { id: "n1", type: "inovelli-scene-manager", wires: [["h0"], ["h1"]],
      outputs: 2, mappings: MAPPINGS, passthrough: false, ...extra },
    { id: "h0", type: "helper" },
    { id: "h1", type: "helper" },
  ];
}

describe("inovelli-scene-manager", function () {
  afterEach(function () { return helper.unload(); });

  it("routes zwave_js 2-1 events by property_key and value_raw", function (done) {
    const flow = flow21({ integration: "zwave_js", model: "vzw31-sn", idfilter: "23" });
    helper.load(sceneNode, flow, function () {
      helper.getNode("h0").on("input", function () { done(); });
      helper.getNode("h1").on("input", function () { done(new Error("wrong output")); });
      helper.getNode("n1").receive({
        payload: {
          event_type: "zwave_js_value_notification",
          event: { domain: "zwave_js", node_id: 23, command_class: 91,
            property: "scene", property_key: "002", value: "KeyPressed2x", value_raw: 3 },
        },
      });
    });
  });

  it("routes zha_event commands", function (done) {
    const flow = flow21({ integration: "zha", model: "vzm31-sn", idfilter: "00:0d:6f:00:0a:bb:cc:dd" });
    helper.load(sceneNode, flow, function () {
      helper.getNode("h1").on("input", function () { done(); });
      helper.getNode("n1").receive({
        payload: {
          event_type: "zha_event",
          event: { device_ieee: "00:0d:6f:00:0a:bb:cc:dd", command: "button_3_press", args: {} },
        },
      });
    });
  });

  it("routes zigbee2mqtt action payloads by topic device name", function (done) {
    const flow = flow21({ integration: "zigbee2mqtt", model: "vzm31-sn", idfilter: "Office Switch" });
    helper.load(sceneNode, flow, function () {
      helper.getNode("h0").on("input", function () { done(); });
      helper.getNode("n1").receive({
        topic: "zigbee2mqtt/Office Switch",
        payload: { action: "up_double" },
      });
    });
  });

  it("routes matter event entity state changes", function (done) {
    const flow = flow21({
      integration: "matter", model: "vtm31-sn",
      matterup: "event.office_up", matterdown: "event.office_down", matterconfig: "event.office_config",
    });
    helper.load(sceneNode, flow, function () {
      helper.getNode("h1").on("input", function () { done(); });
      helper.getNode("n1").receive({
        payload: {
          event_type: "state_changed",
          entity_id: "event.office_config",
          event: {
            entity_id: "event.office_config",
            new_state: { attributes: { event_type: "multi_press_1" } },
          },
        },
      });
    });
  });

  it("keeps legacy LZW31 fixed-map routing", function (done) {
    const flow = [
      { id: "n1", type: "inovelli-scene-manager", wires: [["h0"]],
        integration: "zwave_js", model: "lzw31-sn", idfilter: "13",
        outputs: 1, mappings: "[]", passthrough: false },
      { id: "h0", type: "helper" },
    ];
    helper.load(sceneNode, flow, function () {
      // Legacy map index 0 for LZW31 = button 2, scene 0 (paddle up single tap)
      helper.getNode("h0").on("input", function () { done(); });
      helper.getNode("n1").receive({
        payload: {
          event_type: "zwave_js_value_notification",
          event: { domain: "zwave_js", node_id: 13, command_class: 91,
            property: "scene", property_key: "002", value: "KeyPressed", value_raw: 0 },
        },
      });
    });
  });

  it("ignores events for other devices when passthrough is off", function (done) {
    const flow = flow21({ integration: "zwave_js", model: "vzw31-sn", idfilter: "23" });
    helper.load(sceneNode, flow, function () {
      let hit = false;
      helper.getNode("h0").on("input", function () { hit = true; });
      helper.getNode("n1").receive({
        payload: {
          event_type: "zwave_js_value_notification",
          event: { domain: "zwave_js", node_id: 99, command_class: 91,
            property: "scene", property_key: "002", value: "KeyPressed2x", value_raw: 3 },
        },
      });
      setTimeout(function () { hit ? done(new Error("should be filtered")) : done(); }, 50);
    });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test`
Expected: FAIL

- [ ] **Step 3: Rewrite the node**

`nodes/inovelli-scene-manager.js` (replace entire file):

```js
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
      const resolved = d.resolve(config.model);
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
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add nodes/inovelli-scene-manager.js test/scene_node_spec.js
git commit -m "feat: scene manager normalizes zwave_js/zha/z2m/matter events"
```

---

### Task 14: Scene manager editor UI

**Files:**
- Modify: `nodes/inovelli-scene-manager.html` (full rewrite)

**Interfaces:**
- Consumes: config property names from Task 13. `mappings` is stored as a JSON string; the editable list serializes to it in `oneditsave`.

- [ ] **Step 1: Rewrite the editor file**

Registration essentials:

```js
defaults: {
  name: { value: "" },
  integration: { value: "zwave_js" },
  model: { value: "vzw31-sn" },
  idfilter: { value: "" },
  passthrough: { value: false },
  matterup: { value: "" },
  matterdown: { value: "" },
  matterconfig: { value: "" },
  mappings: { value: "[]" },
  outputs: { value: 1 },
},
inputs: 1,
outputs: 1,
outputLabels: function (i) {
  try {
    const m = JSON.parse(this.mappings)[i];
    return m ? `${m.button} ${m.tap}` : `output ${i + 1}`;
  } catch (e) { return `output ${i + 1}`; }
},
```

`oneditprepare` builds a `$("#node-scene-mappings").editableList(...)` where each row is two selects (button: Up/Down/Config; tap: 1x/2x/3x/4x/5x/Hold/Release with values `single|double|triple|quadruple|quintuple|held|release`), seeded from `JSON.parse(this.mappings)`. For legacy models (`lzw*`) hide the mapping list and show a numeric outputs field (legacy fixed-map behavior, same labels as the old node help text). `oneditsave` serializes the list back to `this.mappings` and sets `this.outputs = list length` (or the numeric field for legacy models):

```js
oneditsave: function () {
  const model = $("#node-input-model").val() || "";
  if (model.startsWith("lzw")) {
    this.outputs = parseInt($("#node-input-legacy-outputs").val(), 10) || 1;
    this.mappings = "[]";
  } else {
    const rows = [];
    $("#node-scene-mappings").editableList("items").each(function () {
      rows.push({
        button: $(this).find(".scene-button").val(),
        tap: $(this).find(".scene-tap").val(),
      });
    });
    this.mappings = JSON.stringify(rows);
    this.outputs = rows.length || 1;
  }
},
```

Integration/model selects and visibility toggling reuse the Task 10 pattern (`MODELS` limited to devices with `scenes`: drop `vzm36`). `row-matter` shows three entity-id inputs (`node-input-matterup`, `node-input-matterdown`, `node-input-matterconfig`); `row-zwave`/`row-zha`/`row-z2m` show the `node-input-idfilter` text with an integration-appropriate label (Node ID(s) / IEEE / Device name(s)). Help block documents the four input wiring patterns (events:all for zwave_js and zha, mqtt-in for zigbee2mqtt, events:state for matter) and notes Red 2-1 aux events pass through only via Z2M/ZHA aux actions.

- [ ] **Step 2: Verify**

Run: `npm test`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add nodes/inovelli-scene-manager.html
git commit -m "feat: scene manager editor UI with button/tap output mapping"
```

---

### Task 15: README, examples, and multicast docs

**Files:**
- Modify: `README.md` (full rewrite)
- Create: `examples/notification_zwave_js.json`, `examples/notification_zigbee2mqtt.json`, `examples/notification_zha.json`, `examples/notification_matter.json`, `examples/scene_manager_21.json`
- Delete: `examples/inject_values.json`, `examples/led_manager.json`, `examples/lock_notifications.json`, `examples/scene_manager.json`, `examples/scene_manager_with_entityid.json`, `examples/sync_led_brightness_with_smart_bulbs.json`
- Keep: `multicast/` (still accurate for Z-Wave JS; update `multicast/README.md` heading to reference the new package name)

**Interfaces:** none (documentation).

- [ ] **Step 1: Rewrite README.md**

Required sections and content:

1. **Title + one-paragraph description** naming the package `node-red-contrib-ha-inovelli` and crediting the two upstream projects (ryanjohnsontv fork lineage, pdong original).
2. **Device support matrix** (exactly this table):

```markdown
| Device | Notifications | LED bar settings | Scenes | Integration(s) |
|---|---|---|---|---|
| VZM31-SN / VZM32-SN (Blue 2-1) | ✅ incl. per-LED | ✅ | ✅ | Zigbee2MQTT, ZHA |
| VZM35-SN (Blue fan) | ✅ incl. per-LED | ✅ | ✅ | Zigbee2MQTT, ZHA |
| VZM36 (Blue canopy) | — | ✅ (light + fan) | — | Zigbee2MQTT, ZHA |
| VZW31-SN / VZW32-SN (Red 2-1) | ✅ incl. per-LED | ✅ | ✅ | Z-Wave JS |
| VTM31-SN / VTM35-SN (White) | ✅ (no duration on device; node self-clears) | ✅ (no off-color) | ✅ | Matter |
| LZW30-SN / LZW31-SN / LZW36 | ✅ | ✅ | ✅ | Z-Wave JS |
| LZW45 | — | — | ✅ | Z-Wave JS |
```

3. **Requirements**: Node-RED 3.x, node-red-contrib-home-assistant-websocket (current version with the Action node), HA 2024.8+ for Matter multi-press events.
4. **Per-node usage** — for each node: what it does, per-integration target fields, and one YAML-ish payload example.
5. **Payload override reference** — table of every `msg.payload` key from Tasks 9/11/13 interfaces.
6. **Wiring diagrams (text)** — notification/LED managers → HA Action node; scene manager inputs: events:all (Z-Wave JS/ZHA), mqtt-in on `zigbee2mqtt/<device name>` (Z2M), events:state on the three `event.*` entities (Matter).
7. **Migration from node-red-contrib-ha-inovelli-manager** — package renamed; OZW/legacy-zwave dropped; output is `payload.action` format (old `domain`/`service` gone); level scale is native per device; node names unchanged so flows import but must be re-pointed to the new palette entry.
8. **White Series caveats** — no duration (node schedules clear; restart cancels it), 13 colors, quantized brightness, no per-LED.

- [ ] **Step 2: Create example flows**

Each example is a minimal 3-node flow (inject → inovelli node → HA action-node placeholder). `examples/notification_zwave_js.json`:

```json
[
  { "id": "inject1", "type": "inject", "name": "Trigger", "props": [{ "p": "payload" }],
    "payload": "{\"color\":\"red\",\"effect\":\"pulse\",\"duration\":\"30 seconds\",\"level\":80}",
    "payloadType": "json", "wires": [["notif1"]] },
  { "id": "notif1", "type": "inovelli-notification-manager", "name": "Office notification",
    "integration": "zwave_js", "model": "vzw31-sn", "entityid": "light.office_switch",
    "color": 0, "level": 100, "duration": 255, "effect": "pulse", "led": "all",
    "clear": false, "multicast": false, "wires": [["action1"]] },
  { "id": "action1", "type": "api-call-service", "name": "HA Action", "wires": [[]] }
]
```

Create the other four by changing the inovelli node's integration/model/target fields to match the Task 9/13 test configurations (zigbee2mqtt: `basetopic`+`devicename`; zha: `ieee`; matter: the three entity ids; scene example: `inovelli-scene-manager` wired from an `server-events` node with two outputs using the Task 13 MAPPINGS values). Write each file out fully — no references.

- [ ] **Step 3: Verify examples are valid JSON**

Run: `node -e "['zwave_js','zigbee2mqtt','zha','matter'].forEach(n=>JSON.parse(require('fs').readFileSync('examples/notification_'+n+'.json')));JSON.parse(require('fs').readFileSync('examples/scene_manager_21.json'));console.log('ok')"`
Expected: `ok`

- [ ] **Step 4: Commit**

```bash
git add README.md examples/ multicast/README.md
git rm examples/inject_values.json examples/led_manager.json examples/lock_notifications.json examples/scene_manager.json examples/scene_manager_with_entityid.json examples/sync_led_brightness_with_smart_bulbs.json
git commit -m "docs: rewrite README and examples for the 2-1 generation"
```

---

### Task 16: CI and publish readiness

**Files:**
- Modify: `.github/workflows/main.yml`
- Delete: `.github/workflows/stale.yml` (stale-bot noise on a fresh package)

**Interfaces:** none.

- [ ] **Step 1: Update CI workflow**

`.github/workflows/main.yml`:

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:
jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node-version: [18.x, 20.x, 22.x]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node-version }}
      - run: npm ci
      - run: npm test
```

- [ ] **Step 2: Full test run and pack dry-run**

Run: `npm test && npm pack --dry-run`
Expected: all tests pass; pack file list includes `nodes/lib/**`, all six node files, `README.md`, `examples/`, `multicast/` and nothing from `test/` unless intended (add a `files` array to package.json — `["nodes", "examples", "multicast", "README.md", "LICENSE"]` — if test files leak in).

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/main.yml package.json
git rm .github/workflows/stale.yml
git commit -m "chore: CI matrix on Node 18/20/22, pack hygiene"
```

- [ ] **Step 4: Publish (manual, user action)**

`npm publish` requires the user's npm login — stop and hand off. Suggested: `npm publish --access public` after a final `npm pack --dry-run` review, then `git tag v1.0.0 && git push origin main --tags`.

---

## Verification checklist (post-plan)

- `npm test` green across all suites.
- The VZW worked example (96340490) and LZW legacy formula tests both pass — the two byte layouts are independently locked.
- Import each `examples/*.json` into a scratch Node-RED; editor UIs switch fields per integration without console errors.
- With a live HA instance (user smoke test): one notification per integration path reaches hardware.

