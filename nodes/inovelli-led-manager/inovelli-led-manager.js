'use strict';

const utils = require('../lib/inovelli-utils');

module.exports = function (RED) {
  function LedManager(config) {
    RED.nodes.createNode(this, config);
    const node = this;
    node.on('input', function (msg) {
      try {
        const p = msg.payload && typeof msg.payload === 'object' ? msg.payload : {};
        const integration = String(p.zwave || config.zwave || 'zwave_js').toLowerCase();
        const ids = utils.integrationId(integration, p.entity_id !== undefined ? p.entity_id : config.entity_id, p.node_id !== undefined ? p.node_id : config.node_id);
        const model = utils.resolveSwitchType(p.switchtype !== undefined ? p.switchtype : config.switchtype || 'lzw31-sn');
        const params = utils.PARAMETERS[model.key];
        if (!params) throw new TypeError('LED parameters are not defined for switch type ' + model.name);
        const val = (key, fallback) => p[key] !== undefined ? p[key] : config[key] !== undefined && config[key] !== '' ? config[key] : fallback;
        const definitions = [
          ['color', params.ledColor, utils.parseHue(val('color', 0))],
          ['brightness', params.brightnessOn, Number(val('brightness', 10))],
          ['brightnessOff', params.brightnessOff, Number(val('brightnessOff', 1))]
        ];
        if (params.fanColor !== undefined) definitions.push(['fanColor', params.fanColor, utils.parseHue(val('fanColor', 0))], ['fanBrightness', params.fanBrightness, Number(val('fanBrightness', 10))], ['fanBrightnessOff', params.fanBrightnessOff, Number(val('fanBrightnessOff', 1))]);
        definitions.forEach((entry) => { if (!Number.isInteger(entry[2]) || (entry[0].indexOf('brightness') >= 0 && (entry[2] < 0 || entry[2] > 10))) throw new TypeError('Invalid value for ' + entry[0]); });
        const multicast = p.multicast !== undefined ? Boolean(p.multicast) : Boolean(config.multicast);
        node.status({ fill: 'green', shape: 'dot', text: 'sent ' + definitions.length + ' parameter(s)' });
        node.send([definitions.map(function (entry) {
          const out = Object.assign({}, msg);
          out.payload = { domain: integration === 'zwave_js' ? 'zwave_js' : 'zwave', service: 'set_config_parameter', data: Object.assign({}, ids, { parameter: entry[1], value: entry[2] }) };
          if (multicast && integration === 'zwave_js') out.payload.data.multicast = true;
          return out;
        })]);
      } catch (error) {
        node.status({ fill: 'red', shape: 'ring', text: error.message });
        node.error(error, msg);
      }
    });
  }
  RED.nodes.registerType('inovelli-led-manager', LedManager);
};
