# Design: Modernize Inovelli Manager for the 2-1 Device Generation

**Date:** 2026-07-01
**Repo:** zpearce-2814/node-red-contrib-ha-inovelli-manager (fork of ryanjohnsontv)
**Destination:** New npm package (renamed, v1.0.0)

## 1. Goals

Update the three Node-RED nodes (notification manager, LED manager, scene manager) to
support the full current Inovelli lineup across all Home Assistant integration paths,
and publish the result as a new npm package.

**In scope**

| Family | Devices | Integration path(s) |
|---|---|---|
| Blue Series (Zigbee) | VZM31-SN, VZM32-SN, VZM35-SN, VZM36 (config-only) | Zigbee2MQTT (`mqtt.publish`), ZHA (`zha.issue_zigbee_cluster_command` / `zha.set_zigbee_cluster_attribute`) |
| Red Series 2-1 (Z-Wave 800) | VZW31-SN, VZW32-SN | Z-Wave JS (`bulk_set_partial_config_parameters`, `set_config_parameter`, `multicast_set_value`) |
| White Series (Matter/Thread) | VTM31-SN, VTM35-SN | HA Matter entities (`light.turn_on/off`, `select.select_option`, `number.set_value`) |
| Legacy Gen-2 (Z-Wave) | LZW30-SN, LZW31-SN, LZW36, LZW45 (scenes) | Z-Wave JS only |

**Out of scope**

- OpenZWave (`ozw`) and legacy `zwave` integrations — removed from HA years ago; dropped.
- VZM36 canopy LED notifications (device has no LED bar or buttons; persistent-config only).
- Red 2-1 aux-switch scene keys `004`–`006` as named outputs (per-button assignment
  unverified upstream; events pass through raw, documented as such).
- White Series per-LED control and effect duration (not exposed over Matter).
- mmWave presence-sensor configuration (params 101–119 / cluster 0xFC32) — future work.
- A general "parameter manager" node for arbitrary config parameters — future work.

## 2. Package identity

- New name: **`node-red-contrib-ha-inovelli`**. If taken on npm at implementation time,
  use **`@zpearce/node-red-contrib-ha-inovelli`** (Node-RED palette supports scoped names).
- Version **1.0.0**. `repository`/`author` updated to this fork. MIT license retained.
- Node type names (`inovelli-notification-manager`, etc.) stay the same so exported
  flow JSON remains portable between old and new package where features overlap.

## 3. Architecture

Approach chosen: **shared device registry + per-protocol encoders** (Approach B of the
brainstorm). The three nodes become thin consumers of shared modules:

```
nodes/
  lib/
    devices.js        # declarative registry: one entry per device model
    convert.js        # color / duration / level normalization (pure functions)
    encoders/
      zwavejs.js      # packed 4-byte values -> zwave_js actions
      zigbee2mqtt.js  # JSON payloads -> mqtt.publish actions
      zha.js          # cluster commands/attributes -> zha.* actions
      matter.js       # entity-based action sequences (light/select/number)
  inovelli-notification-manager.{js,html}
  inovelli-led-manager.{js,html}
  inovelli-scene-manager.{js,html}
```

### 3.1 Device registry (`lib/devices.js`)

One entry per model, keyed by lowercase model id, containing only data (no logic):

- `protocols`: which integrations the model supports (`zwave_js`, `zigbee2mqtt`, `zha`, `matter`).
- `notification`: for Z-Wave — parameter numbers (all-LED `99`; individual LEDs
  `64,69,74,79,84,89,94`, LED1=bottom) and byte layout id (`vzw` vs `lzw` — the two
  generations pack color/duration in swapped byte positions); for Zigbee — command ids
  (1 all-LED, 3 individual, cluster 64561, manufacturer 4655); for Matter — the entity
  roles required (LED light entity, LED Effect select, LED Color select).
- `effects`: map of effect name → integer for all-LED and individual-LED sets
  (legacy switch 0–4, legacy dimmer 0–5, 2-1 all-LED 0–19 + 255 clear,
  2-1 individual 0–8 + 255 clear, White Series select-option strings).
- `ledBar`: persistent-setting parameters/attributes (legacy 5/6/7, 13/14/15, 18–23;
  2-1 Z-Wave 95–98; Zigbee attrs `ledColorWhenOn/Off` 0x5F/0x60,
  `ledIntensityWhenOn/Off` 0x61/0x62; VZM36 endpoint-suffixed `_1`/`_2` variants;
  Matter select/number entity roles).
- `scenes`: event maps (legacy LZW maps carried over verbatim; 2-1 Z-Wave
  `property_key` `001`=down/`002`=up/`003`=config with `value_raw` 0–6;
  ZHA `button_1/2/3` × `press/release/hold/double/triple/quadruple/quintuple`;
  Z2M `down|up|config` × `single/release/held/double/triple/quadruple/quintuple`;
  Matter `event_type` `multi_press_1..N`/`long_press`/`long_release`).
- `levelRange`: `0–10` for legacy models, `0–100` for 2-1 models (native ranges, no
  silent scaling; the editor slider adapts).

Model aliases accepted anywhere a model is given: e.g. `"blue 2-1"` → vzm31-sn,
`"red 2-1"` → vzw31-sn, plus the existing legacy aliases (`dimmer`, `switch`, `fan`, …)
which continue to resolve to legacy models for payload compatibility.

### 3.2 Converters (`lib/convert.js`)

Pure functions, unit-tested:

- `toHue(color)` — accepts color name, `#hex`, `[r,g,b]`, or number 0–361 (361=white);
  returns device hue 0–255 (255=white). Legacy formula (`hsl_hue × 17/24`) retained for
  legacy models; 2-1 uses `hue/360 × 254`; both agree that 255=white.
- `toDuration(input, generation)` — accepts seconds int or strings ("30 seconds",
  "5 minutes", "2 hours", "forever"); encodes 1–60 s / 61–120 min / 121–254 h / 255
  indefinite. Same encoding for both generations.
- `toLevel(input, range)` — validates against the device's native range.
- `snapToMatterColor(rgb)` — nearest of the 13 White Series named colors;
  `snapToMatterBrightness(pct)` — nearest supported quantized step.

### 3.3 Encoders (`lib/encoders/*.js`)

Each takes `(device, fields, target)` and returns an array of one or more messages in the
**modern Action-node format**: `{ payload: { action, target, data } }`.

- **zwavejs**: packs `(effect<<24)|(color<<16)|(level<<8)|duration` for 2-1 models and
  the legacy `color + level<<8 + duration<<16 + effect<<24` layout for LZW models;
  emits `zwave_js.bulk_set_partial_config_parameters` (or `zwave_js.set_config_parameter`
  for single-byte LED-bar params; `zwave_js.multicast_set_value` with command_class 112
  when multicast is enabled). Target: `entity_id` list (or `device_id`/`area_id`
  pass-through from the payload).
- **zigbee2mqtt**: emits `mqtt.publish` actions with
  `data: { topic: "<base>/<name>/set", payload: JSON }` — `led_effect` /
  `individual_led_effect` composites (led "1"–"7" as strings, top=7) and persistent
  attributes by property name. Base topic configurable (default `zigbee2mqtt`).
- **zha**: emits `zha.issue_zigbee_cluster_command` (endpoint 1, cluster 64561,
  command 1/3, command_type server, manufacturer 4655, `params:` dict with
  `led_effect/led_color/led_level/led_duration` and 0-based `led_number`) and
  `zha.set_zigbee_cluster_attribute` for persistent settings. Target: `ieee` (user-supplied).
- **matter**: composes sequences —
  *solid notification*: `light.turn_on` on the LED-bar light entity with
  `rgb_color` + `brightness_pct`;
  *animated notification*: `select.select_option` on LED Color select (snapped color)
  then LED Effect select;
  *clear*: `light.turn_off` + LED Effect select "Off";
  *persistent settings*: LED Color select + intensity `number.set_value` on the
  user-supplied `*_on`/`*_off` entities.
  Because Matter has **no duration**, when a finite duration is configured the
  notification node schedules the clear sequence itself via `setTimeout` (cleared on
  node redeploy; caveat documented: a Node-RED restart cancels pending clears).

## 4. Node designs

All three nodes share editor conventions: an **Integration** dropdown
(`Z-Wave JS`, `Zigbee2MQTT`, `ZHA`, `Matter`) that filters the **Device model** dropdown
and toggles the visible target fields (entity IDs / MQTT device name / IEEE / Matter
entity IDs). Every configurable field remains overridable via `msg.payload.*`, preserving
the existing override API (`color`, `brightness`, `duration`, `effect`, `clear`,
`multicast`, `entity_id`, plus new: `level`, `led`, `model`, `integration`, `topic`,
`ieee`). `switchtype` and `zwave` remain accepted as aliases for `model` and
`integration`.

### 4.1 Notification manager

Fields: integration, model, target, color (0–361 slider + payload formats), level
(slider adapting to 0–10 or 0–100), duration (dropdown + free-form payload strings),
effect (dropdown populated from the model's effect enum), **LED selector**
(All / LED 1–7, individual only for 2-1 models), clear checkbox, multicast checkbox
(Z-Wave JS only). Emits one message per required action (LZW36 fan+light dual-param
behavior carried over; Matter emits its sequence).

### 4.2 LED manager

Fields: integration, model, target, color-when-on / color-when-off (2-1 models have
separate on/off colors; legacy models a single color — UI adapts; White Series has
no off-color, documented), intensity-when-on / intensity-when-off, fan variants for
LZW36 and VZM36 (endpoint-suffixed). Each configured value emits its parameter/attribute
write; unset values are untouched (existing toggle-checkbox pattern retained).

### 4.3 Scene manager

Input sources supported (auto-detected per message):

- `zwave_js_value_notification` events (legacy + Red 2-1) — from an events:all node
- `zha_event` events (Blue via ZHA) — from an events:all node
- Zigbee2MQTT state JSON with `action` (Blue via Z2M) — from an mqtt-in node subscribed
  to `zigbee2mqtt/<name>` (string or parsed-object payloads both handled)
- `state_changed` on Matter `event.*` entities (White) — from an events:state node;
  branches on `attributes.event_type`

Configuration: integration, model, device filter (node IDs / device name / entity IDs),
passthrough toggle (carried over), and an **event→output mapping list** (editableList of
button × tap rows) replacing the fixed legacy output maps for 2-1 devices. Legacy LZW
models keep their existing fixed maps and output ordering so migrated flows behave
identically. Buttons: up/down/config (+ raw passthrough for unrecognized keys, e.g.
Red 2-1 aux `004`–`006`). Taps: 1x–5x, hold, release.

## 5. Output format

All emitted messages use the current Action-node schema of
node-red-contrib-home-assistant-websocket: `msg.payload.action`
(e.g. `"zwave_js.bulk_set_partial_config_parameters"`), `msg.payload.target`
(`entity_id`/`device_id`/`area_id`), `msg.payload.data`. The deprecated
`domain`/`service` output shape is not emitted.

## 6. Error handling

- All validation errors go through `done(err)` (Node-RED 1.0+ API) with the field name
  and offending value; no silent fallbacks.
- Unknown model/integration combinations error at input time (e.g. `matter` +
  notification with individual LED).
- Scene manager ignores (does not error on) events for other nodes/devices when
  passthrough is off, matching existing behavior.
- Matter deferred-clear timers are cancelled on node `close` (redeploy safety).

## 7. Testing

Existing devDeps (`mocha`, `node-red-node-test-helper`) are used for real coverage:

- Unit tests for `convert.js` (color forms, duration strings, boundary values 60/61,
  120/121, 254/255) and each encoder (verified against the researched byte layouts —
  e.g. Chase/violet/10%/10s on VZW31-SN must equal `96340490`).
- Node-level tests: each node loaded in test-helper, one representative flow per
  integration path asserting the exact emitted `payload.action/target/data`.
- Scene manager: fixture events for all four input sources routed to correct outputs.
- CI: existing GitHub Actions workflow updated to run `npm test` on Node 18/20/22.

## 8. Documentation & examples

- README rewritten: device support matrix, per-integration setup (including the MQTT-in
  wiring for Z2M scenes and Matter entity-ID discovery), payload override reference,
  migration notes from the old package (renamed package, dropped OZW/zwave, new output
  format requiring a current HA websocket palette).
- `examples/` refreshed: one importable flow per integration path; legacy examples
  updated to the Action output format. `multicast/` docs kept for Z-Wave JS.

## 9. Milestones

1. **Foundation** — `lib/` modules (registry, converters, encoders) + unit tests.
2. **Notification manager** — all four integrations + node tests.
3. **LED manager** — all four integrations + node tests.
4. **Scene manager** — four input sources, mapping UI + node tests.
5. **Package & docs** — rename, README, examples, CI, npm publish (dry-run then real).

Each milestone leaves the repo in a working state; legacy LZW behavior is protected by
tests written in milestone 1 against the current output values.

## 10. Key design decisions (with rationale)

| Decision | Rationale |
|---|---|
| Device registry over inline conditionals | 10 models × 4 protocols; single source of truth; future devices = data entry |
| Emit Action-node format only | `domain`/`service` no longer documented by the HA palette; new package = clean break |
| Native level ranges (0–10 legacy, 0–100 new) | No silent scaling surprises; matches each device's documentation |
| Node type names unchanged | Flow JSON portability; palette treats package name as the identity anyway |
| Matter durations via node-side timer | Only possible mechanism; caveat documented rather than feature silently missing |
| Aux scenes passthrough-only | Upstream mapping unverified; raw events still usable, no invented facts |
