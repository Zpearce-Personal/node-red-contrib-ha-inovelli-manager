'use strict';

const utils = require('../lib/inovelli-utils');

module.exports = function (RED) {
  function NotificationManager(config) {
    RED.nodes.createNode(this, config);
    const node = this;
    node.on('input', function (msg) {
      try {
        const p = msg.payload && typeof msg.payload === 'object' ? msg.payload : {};
        const integration = String(p.zwave || config.zwave || 'zwave_js').toLowerCase();
        const ids = utils.integrationId(integration, p.entity_id !== undefined ? p.entity_id : config.entity_id, p.node_id !== undefined ? p.node_id : config.node_id);
        const model = utils.resolveSwitchType(p.switchtype !== undefined ? p.switchtype : config.switchtype || 'lzw31-sn');
        const params = utils.PARAMETERS[model.key] || { notificationColor: model.effectParameter, notificationDuration: model.effectParameter + 1, notificationEffect: model.effectParameter + 2, notificationBrightness: model.effectParameter + 3 };
        const values = [];
        const clear = p.clear !== undefined ? Boolean(p.clear) : Boolean(config.clear);
        if (clear) {
          values.push([params.notificationEffect, 0], [params.notificationDuration, 0]);
        } else {
          const color = p.color !== undefined ? p.color : config.color !== undefined && config.color !== '' ? config.color : 0;
          const brightness = p.brightness !== undefined ? p.brightness : config.brightness !== undefined && config.brightness !== '' ? config.brightness : 10;
          const duration = p.duration !== undefined ? p.duration : config.duration || '5 seconds';
          const effect = p.effect !== undefined ? p.effect : config.effect || 'solid';
          const effectTable = utils.EFFECTS[model.key] || utils.EFFECTS[model.name.toLowerCase()];
          const effectValue = Number.isInteger(Number(effect)) ? Number(effect) : effectTable && effectTable[String(effect).toLowerCase()];
          if (!Number.isInteger(Number(brightness)) || Number(brightness) < 0 || Number(brightness) > 10) throw new TypeError('Brightness must be between 0 and 10');
          if (!Number.isInteger(effectValue) || effectValue < 0 || effectValue > 255) throw new TypeError('Unknown notification effect: ' + effect);
          values.push([params.notificationColor, utils.parseHue(color)], [params.notificationBrightness, Number(brightness)], [params.notificationDuration, utils.parseDuration(duration)], [params.notificationEffect, effectValue]);
        }
        const multicast = p.multicast !== undefined ? Boolean(p.multicast) : Boolean(config.multicast);
        node.status({ fill: 'green', shape: 'dot', text: 'sent ' + values.length + ' parameter(s)' });
        node.send([values.map(function (entry) {
          const out = Object.assign({}, msg);
          out.payload = { domain: integration === 'zwave_js' ? 'zwave_js' : 'zwave', service: 'set_config_parameter', data: Object.assign({}, ids, { parameter: entry[0], value: entry[1] }) };
          if (multicast && integration === 'zwave_js') out.payload.data.multicast = true;
          return out;
        })]);
      } catch (error) {
        node.status({ fill: 'red', shape: 'ring', text: error.message });
        node.error(error, msg);
      }
    });
  }
  RED.nodes.registerType('inovelli-notification-manager', NotificationManager);
};
