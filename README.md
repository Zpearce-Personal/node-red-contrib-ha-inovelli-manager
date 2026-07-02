# node-red-contrib-ha-inovelli

Node-RED nodes for setting Inovelli LED bar notifications, persisting LED bar settings, and decoding multi-tap scene/button events on Inovelli switches through Home Assistant — covering the Red (Z-Wave JS), Blue (Zigbee2MQTT/ZHA), White (Matter), and legacy Red Gen 2 (LZW, Z-Wave JS) product lines.

This package is a ground-up rewrite of [`node-red-contrib-ha-inovelli-manager`](https://github.com/ryanjohnsontv/node-red-contrib-ha-inovelli-manager) (ryanjohnsontv), which was itself forked from [`node-contrib-inovelli-status-manager`](https://github.com/pdong/node-contrib-inovelli-status-manager) (pdong) — thanks to both for the original groundwork this builds on.

Connect the output of the Notification Manager or LED Manager node directly to a Home Assistant **Action** node (`api-call-service`) — no manual `domain`/`service`/`data` lookups required. Wire the Scene Manager's input from the appropriate Home Assistant events node (or an `mqtt in` node for Zigbee2MQTT) to get one output per configured button/tap combination. [Example flows](#example-flows) are included for every integration.

## Device support

| Device | Notifications | LED bar settings | Scenes | Integration(s) |
|---|---|---|---|---|
| VZM31-SN / VZM32-SN (Blue 2-1) | ✅ incl. per-LED | ✅ | ✅ | Zigbee2MQTT, ZHA |
| VZM35-SN (Blue fan) | ✅ incl. per-LED | ✅ | ✅ | Zigbee2MQTT, ZHA |
| VZM36 (Blue canopy) | — | ✅ (light + fan) | — | Zigbee2MQTT, ZHA |
| VZW31-SN / VZW32-SN (Red 2-1) | ✅ incl. per-LED | ✅ | ✅ | Z-Wave JS |
| VTM31-SN / VTM35-SN (White) | ✅ (no duration on device; node self-clears) | ✅ (no off-color) | ✅ | Matter |
| LZW30-SN / LZW31-SN / LZW36 | ✅ | ✅ | ✅ | Z-Wave JS |
| LZW45 | — | — | ✅ | Z-Wave JS |

## Requirements

- Node-RED 3.x
- [`node-red-contrib-home-assistant-websocket`](https://github.com/zachowj/node-red-contrib-home-assistant-websocket) — a current version that includes the Action (`api-call-service`) node
- Home Assistant 2024.8+ for Matter multi-press events (`multi_press_1`…`multi_press_5`, `long_press`, `long_release`), used by the Scene Manager for White Series switches
- Zigbee2MQTT scene input additionally requires an `mqtt in` node (Node-RED core palette, no extra install) subscribed to the device's MQTT topic

## Inovelli Notification Manager

Builds the Action-node message for a temporary LED bar notification — color, level, effect, and duration — on the whole bar or (Blue/Red 2-1 only) a single LED segment. Setting `clear` (or checking Clear Notification) turns off the current notification instead.

| Integration | Target field(s) | Config propert(y/ies) | Payload override(s) |
|---|---|---|---|
| Z-Wave JS | Entity ID(s), comma-delimited | `entityid` | `entity_id` |
| Zigbee2MQTT | Base topic + device friendly name | `basetopic` + `devicename` | `topic` + `device` |
| ZHA | IEEE address | `ieee` | `ieee` |
| Matter | LED light entity, LED effect select entity, LED color select entity | `matterlight` + `mattereffect` + `mattercolor` | `light_entity` + `effect_entity` + `color_entity` |

```yaml
# msg.payload for a Zigbee2MQTT notification
payload:
  integration: zigbee2mqtt
  device: "Office Switch"
  color: red
  level: 100
  duration: "30 seconds"
  effect: pulse
```

### Payload override reference

Any value configured on the node can be overridden per-message via the matching `msg.payload` key.

| Payload key | Alias | Meaning |
|---|---|---|
| `integration` | `zwave` | `zwave_js`, `zigbee2mqtt`, `zha`, or `matter` |
| `model` | `switchtype` | Inovelli model id (e.g. `vzw31-sn`) or a legacy name/numeric switchtype |
| `entity_id` | — | Z-Wave JS entity id(s), comma-delimited |
| `topic` | — | Zigbee2MQTT base topic (default `zigbee2mqtt`) |
| `device` | — | Zigbee2MQTT device friendly name |
| `ieee` | — | ZHA IEEE address |
| `light_entity` | — | Matter LED light entity |
| `effect_entity` | — | Matter LED effect select entity |
| `color_entity` | — | Matter LED color select entity |
| `color` | — | Color name, hex, RGB array, or 0–360° hue (361 = white) |
| `level` | `brightness` | Brightness: 0–10 (legacy LZW), 0–100 (VZW/VZM/VTM) |
| `duration` | — | Duration byte 0–255, or a friendly string (`"30 seconds"`, `"2 hours"`, `"indefinitely"`) |
| `effect` | — | Effect name or numeric id, filtered by model and LED selection |
| `led` | — | `all`, or an LED segment 1 (bottom)–7 (top) (Blue/Red 2-1 only) |
| `clear` | — | `true` clears the current notification instead of setting one |
| `multicast` | — | (Z-Wave JS only) `true` sends via `zwave_js.multicast_set_value` |

## Inovelli LED Manager

Builds the Action-node message(s) for the switch's *persistent* idle-state LED bar — color and brightness, for on and off, per load (main; plus fan on LZW36/VZM36). Each field is only sent if its checkbox is enabled **or** the matching key is present on `msg.payload` — otherwise that setting is left untouched on the device. At least one field must be active or the node errors.

| Integration | Target field(s) | Config propert(y/ies) | Payload override(s) |
|---|---|---|---|
| Z-Wave JS | Entity ID(s), comma-delimited | `entityid` | `entity_id` |
| Zigbee2MQTT | Base topic + device friendly name | `basetopic` + `devicename` | `topic` + `device` |
| ZHA | IEEE address | `ieee` | `ieee` |
| Matter | LED color select entity, LED intensity (on/off) number entities | `mattercolor` + `matterintensityon` + `matterintensityoff` | `color_entity` + `intensity_on_entity` + `intensity_off_entity` |

```yaml
# msg.payload for a Z-Wave JS LED bar update
payload:
  integration: zwave_js
  entity_id: light.office
  color: blue
  brightness: 100
  brightnessOff: 5
```

### Payload override reference

| Payload key | Alias | Meaning |
|---|---|---|
| `integration` | `zwave` | `zwave_js`, `zigbee2mqtt`, `zha`, or `matter` |
| `model` | `switchtype` | Inovelli model id or legacy name/numeric switchtype |
| `entity_id` | — | Z-Wave JS entity id(s), comma-delimited |
| `topic` | — | Zigbee2MQTT base topic |
| `device` | — | Zigbee2MQTT device friendly name |
| `ieee` | — | ZHA IEEE address |
| `color_entity` | — | Matter LED color select entity |
| `intensity_on_entity` | — | Matter LED intensity (on) number entity |
| `intensity_off_entity` | — | Matter LED intensity (off) number entity |
| `color` | — | LED bar color while the load is on |
| `colorOff` | — | LED bar color while the load is off (VZW/VZM only — legacy LZW shares one color, Matter has no off color) |
| `brightness` | — | LED bar brightness while the load is on |
| `brightnessOff` | — | LED bar brightness while the load is off |
| `fanColor` | — | Fan LED bar color (LZW36/VZM36 only) |
| `fanBrightness` | — | Fan LED bar brightness while on (LZW36/VZM36 only) |
| `fanBrightnessOff` | — | Fan LED bar brightness while off (LZW36/VZM36 only) |

## Inovelli Scene Manager

Decodes button-press (scene) events from an upstream Home Assistant node and routes them to one output per configured button/tap combination. This node has no payload-override keys — it's configured entirely through the editor (integration, model, device-identifier filter/passthrough or the three Matter event entities, and the output mapping list) and reacts to whatever event message its upstream node delivers.

Wire its input from, depending on Integration:

| Integration | Wire the input from |
|---|---|
| Z-Wave JS, ZHA | A Home Assistant **Events: all** node (`server-events`) — listens for `zwave_js_value_notification` / `zha_event` |
| Zigbee2MQTT | An `mqtt in` node subscribed to `zigbee2mqtt/<device name>` (or its `.../action` subtopic) — accepts both raw-string and parsed-JSON action payloads |
| Matter | A Home Assistant **Events: state** node watching the three `event.*` entities configured on the node (Up/Down/Config) |

For VZW/VZM/VTM models, each output row in the editor's Output Mapping list picks a **Button** (Up/Down/Config, plus Blue Series Aux options — see below) and a **Tap** (1x–5x, Hold, Release); the node's output count always matches the number of rows. Legacy LZW30/LZW31/LZW36/LZW45 models instead use a fixed physical-button-to-output map (below) with a plain "Number of Outputs" field.

### Legacy LZW output order

The legacy LZW models don't use the configurable mapping list — button-press scene events are decoded and routed to a fixed output index, carried over unchanged from the original scene manager. Set "Number of Outputs" to however many of these you need wired up, starting from output 0.

Scene → tap legend (LZW30-SN, LZW31-SN, LZW36): `0`=1x tap, `1`=release, `2`=held, `3`=2x tap, `4`=3x tap, `5`=4x tap, `6`=5x tap.
Scene → tap legend (LZW45 — shifted by one): `1`=1x tap, `2`=release, `3`=held, `4`=2x tap, `5`=3x tap, `6`=4x tap, `7`=5x tap.

#### LZW30-SN (On/Off) and LZW31-SN (Dimmer)

Button legend: `1`=down paddle, `2`=up paddle, `3`=config button.

| Output | Button | Tap |
|---|---|---|
| 0 | 2 (up paddle) | 1x tap |
| 1 | 2 (up paddle) | 2x tap |
| 2 | 2 (up paddle) | 3x tap |
| 3 | 2 (up paddle) | 4x tap |
| 4 | 2 (up paddle) | 5x tap |
| 5 | 2 (up paddle) | held |
| 6 | 2 (up paddle) | release |
| 7 | 1 (down paddle) | 1x tap |
| 8 | 1 (down paddle) | 2x tap |
| 9 | 1 (down paddle) | 3x tap |
| 10 | 1 (down paddle) | 4x tap |
| 11 | 1 (down paddle) | 5x tap |
| 12 | 1 (down paddle) | held |
| 13 | 1 (down paddle) | release |
| 14 | 3 (config) | 1x tap |

#### LZW36 (Fan + Light)

Button legend: `2`=light paddle (full multi-tap/hold/release), `3`=light rocker up, `4`=light rocker down, `1`=fan paddle (full multi-tap/hold/release), `5`=fan rocker up, `6`=fan rocker down. (Rocker up/down are single-tap only.)

| Output | Button | Tap | Physical control |
|---|---|---|---|
| 0 | 2 | 1x tap | Light paddle |
| 1 | 2 | 2x tap | Light paddle |
| 2 | 2 | 3x tap | Light paddle |
| 3 | 2 | 4x tap | Light paddle |
| 4 | 2 | 5x tap | Light paddle |
| 5 | 2 | held | Light paddle |
| 6 | 2 | release | Light paddle |
| 7 | 3 | 1x tap | Light rocker up |
| 8 | 4 | 1x tap | Light rocker down |
| 9 | 1 | 1x tap | Fan paddle |
| 10 | 1 | 2x tap | Fan paddle |
| 11 | 1 | 3x tap | Fan paddle |
| 12 | 1 | 4x tap | Fan paddle |
| 13 | 1 | 5x tap | Fan paddle |
| 14 | 1 | held | Fan paddle |
| 15 | 1 | release | Fan paddle |
| 16 | 5 | 1x tap | Fan rocker up |
| 17 | 6 | 1x tap | Fan rocker down |

#### LZW45 (Light Strip)

Button legend: `1`=down paddle, `2`=up paddle, `3`=config button (same as LZW30/LZW31; note the shifted scene legend above).

| Output | Button | Tap |
|---|---|---|
| 0 | 2 (up paddle) | 1x tap |
| 1 | 2 (up paddle) | 2x tap |
| 2 | 2 (up paddle) | 3x tap |
| 3 | 2 (up paddle) | 4x tap |
| 4 | 2 (up paddle) | 5x tap |
| 5 | 2 (up paddle) | release |
| 6 | 2 (up paddle) | held |
| 7 | 1 (down paddle) | 1x tap |
| 8 | 1 (down paddle) | 2x tap |
| 9 | 1 (down paddle) | 3x tap |
| 10 | 1 (down paddle) | 4x tap |
| 11 | 1 (down paddle) | 5x tap |
| 12 | 1 (down paddle) | release |
| 13 | 1 (down paddle) | held |
| 14 | 3 (config) | 1x tap |

### Auxiliary button support

Blue Series (Zigbee) 2-1 switches support an auxiliary switch input. Its taps are reported as Zigbee2MQTT `aux_up`/`aux_down`/`aux_config` actions, or as ZHA `button_4`/`button_5`/`button_6` events, and are routed via the **Aux Up** / **Aux Down** / **Aux Config** options in the Output Mapping list's Button dropdown.

Red Series 2-1 aux input (Z-Wave Central Scene keys 004–006) is **not** supported — Inovelli's per-button key assignment for the aux input on that generation is unverified, so no translation table is provided for it.

## Wiring diagrams

```
Notification Manager / LED Manager
  [any trigger] --> [inovelli-notification-manager | inovelli-led-manager] --> [Home Assistant: Action (api-call-service)]

Scene Manager
  Z-Wave JS / ZHA :  [Home Assistant: Events: all]              --> [inovelli-scene-manager] --> one wire per output-mapping row
  Zigbee2MQTT     :  [mqtt in, topic zigbee2mqtt/<device name>] --> [inovelli-scene-manager] --> one wire per output-mapping row
  Matter          :  [Home Assistant: Events: state, watching   --> [inovelli-scene-manager] --> one wire per output-mapping row
                       the three configured event.* entities]
```

## White Series (Matter) caveats

- **No hardware duration.** Matter has no device-side notification-clear timer, so the Notification Manager node schedules its own `setTimeout` to send the clear sequence after the requested duration elapses. A Node-RED restart during that window cancels the pending clear and leaves the notification showing until manually cleared.
- **13 colors.** LED color is chosen from a fixed `select` entity with 12 named hues (Red, Orange, Lemon, Lime, Green, Teal, Cyan, Aqua, Blue, Violet, Magenta, Pink) plus White; any color/hue input is snapped to the nearest of these 13.
- **Quantized brightness.** Brightness snaps to the device's fixed step table (0, 1, 3, 5, 8, 10, 13, …, 100), not an arbitrary 0–100 value.
- **No per-LED addressing** and **no off-color.** Matter switches expose a single LED bar with one on-color; there's no `led` segment option and no `colorOff`.

## Migrating from node-red-contrib-ha-inovelli-manager

This package is the renamed, rewritten successor to `node-red-contrib-ha-inovelli-manager`. Breaking changes to be aware of:

- The npm package is now **`node-red-contrib-ha-inovelli`** — uninstall the old package and install this one under its new name.
- OpenZWave (`ozw`) and the deprecated legacy `zwave` integration have been dropped. Z-Wave JS is the only supported Z-Wave path.
- Output is now Action-node format exclusively: `msg.payload = { action, target?, data }`. The old `domain`/`service`/`entityId` shape is gone — connect the output directly to an `api-call-service` (Action) node instead of a legacy `call-service` node.
- Level/brightness values are native to each device generation — 0–10 for legacy LZW switches, 0–100 for VZW/VZM/VTM 2-1 switches — there is no more universal 0–10 scale applied across all models.
- The three node type names (`inovelli-notification-manager`, `inovelli-led-manager`, `inovelli-scene-manager`) are unchanged, so old flows will still import once this package is installed — but many config field names changed (e.g. `zwave`→`integration`, `switchtype`→`model`, `nodeid`→`entityid`/`idfilter`), so every existing node instance must be reopened and re-pointed at the new fields/palette entry after import.

## Example flows

[`examples/`](./examples) contains one minimal 3-node flow (inject → Inovelli node → Home Assistant Action node) per Notification Manager integration, plus one Scene Manager example:

- [`notification_zwave_js.json`](./examples/notification_zwave_js.json)
- [`notification_zigbee2mqtt.json`](./examples/notification_zigbee2mqtt.json)
- [`notification_zha.json`](./examples/notification_zha.json)
- [`notification_matter.json`](./examples/notification_matter.json)
- [`scene_manager_21.json`](./examples/scene_manager_21.json)

Each notification example ends in a node of type `api-call-service` named **HA Action** — the Home Assistant Action node. If `node-red-contrib-home-assistant-websocket` isn't installed when you import an example, that node shows up as an unrecognized/unknown-type placeholder in the editor; install the palette and it resolves to the real Action node (you'll still need to point it at your Home Assistant server config). The [`multicast/`](./multicast) directory has additional setup for Z-Wave JS multicast notifications.

## License

MIT — see [LICENSE](./LICENSE).
