# node-red-contrib-ha-inovelli-manager

Three Node-RED message transformers for Inovelli notification LEDs, device LEDs, and scene events. Install with **Manage palette** in Node-RED or run `npm install node-red-contrib-ha-inovelli-manager` in your Node-RED user directory.

The notification and LED nodes produce Home Assistant service-call payloads; wire their output to the Home Assistant `api-call-service` node from `node-red-contrib-home-assistant-websocket`. They do not connect to Home Assistant or Z-Wave themselves. Importable flows are in `examples/`.

## Integrations and identifiers

Choose Z-Wave JS, OpenZWave, or deprecated Z-Wave in either transformer node. Z-Wave JS targets `entity_id`; OpenZWave and legacy Z-Wave target `node_id`. Enter comma-separated IDs if the integration's service supports multiple targets. Incoming `msg.payload.zwave`, `entity_id`, and `node_id` override editor values. Supported switch aliases are case-insensitive: `LZW30-SN`, `LZW31-SN`, `LZW36`, `LZW45`, `dimmer`, `switch`, and `fan`; integer effect parameter values are also accepted where applicable.

Both transformer nodes output one message per parameter. Each message has `msg.payload.domain`, `service`, and `data` fields for Home Assistant. Values are encoded for the model's parameter map. A downstream API-call-service node should use the corresponding domain/service and service data from the payload.

## Inovelli Notification Manager

Configure integration and IDs, switch type, color, brightness (0–10), duration (1–255), effect, clear, and multicast. `msg.payload` can override every field: `zwave`, `entity_id`, `node_id`, `switchtype`, `color`, `brightness`, `duration`, `effect`, `clear`, and `multicast`.

Color accepts a hue number from 0 to 361, an RGB array such as `[255,0,0]`, a CSS color name such as `red`, or a hex string such as `#ff0000`; it is converted to Inovelli hue 0–255. Duration accepts numeric seconds or phrases such as `47 seconds`, `2 hours`, or `4 days`. The encoded value is rounded to minutes and clamped to 1–255. Effects are `off`, `solid`, `chase`, `fast blink`, `slow blink`, and `pulse`. Clear emits effect and duration reset writes. Z-Wave JS multicast requires compatible network configuration.

## Inovelli LED Manager

Configure integration and IDs, switch type, LED color, brightness while on and off, fan color and fan brightness while on and off, plus multicast. All editor values have matching payload overrides: `zwave`, `entity_id`, `node_id`, `switchtype`, `color`, `brightness`, `brightnessOff`, `fanColor`, `fanBrightness`, `fanBrightnessOff`, `multicast`. Color uses the same hue/RGB/name/hex conversion; brightness ranges from 0 to 10. Fan writes apply to LZW36.

## Inovelli Scene Manager

Connect a Home Assistant `events-all` node. Select Z-Wave JS or OpenZWave, the device node ID, and LZW30-SN, LZW31-SN, LZW36, or LZW45. Output count follows the selected model's scene map. Recognized multi-click actions route to the corresponding output; optional node ID passthrough adds `msg.node_id`. Only events matching the configured node ID are forwarded.

## Attribution

Forked from [pdong/node-contrib-inovelli-status-manager](https://github.com/pdong/node-contrib-inovelli-status-manager).
