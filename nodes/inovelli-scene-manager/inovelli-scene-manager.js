'use strict';

const utils = require('../lib/inovelli-utils');

function sceneFromMessage(msg, integration) {
  const payload = msg.payload || {};
  const data = payload.event || payload.data || payload;
  const args = data.args || {};
  let nodeId = data.node_id !== undefined ? data.node_id : args.nodeId;
  let scene = data.scene_id !== undefined ? data.scene_id : data.sceneId;
  let keyAttribute = data.property_key !== undefined ? data.property_key : data.propertyKey;
  if (integration === 'zwave_js') {
    scene = scene !== undefined ? scene : args.scene;
    keyAttribute = keyAttribute !== undefined ? keyAttribute : args.keyAttribute !== undefined ? args.keyAttribute : args.propertyKey !== undefined ? args.propertyKey : args.event;
  }
  if (scene === undefined && data.value !== undefined) scene = data.value;
  if (nodeId === undefined && data.device_id !== undefined) nodeId = data.device_id;
  if (nodeId === undefined || scene === undefined) return null;
  if (integration === 'zwave_js' && keyAttribute !== undefined && args.scene !== undefined) {
    const sceneNumber = Number(scene);
    const attribute = keyAttribute;
    const attr = typeof attribute === 'string' ? attribute.toLowerCase() : Number(attribute);
    const click = ({ 0: '1x', 3: '2x', 4: '3x', 5: '4x', 6: '5x', keypressed: '1x', keypressed2x: '2x', keypressed3x: '3x', keypressed4x: '4x', keypressed5x: '5x' })[attr];
    const action = sceneNumber === 1 ? (click ? 'up_' + click : attr === 2 || attr === 'keyhelddown' ? 'up_hold' : attr === 1 || attr === 'keyreleased' ? 'up_release' : null)
      : sceneNumber === 2 ? (click ? 'down_' + click : attr === 2 || attr === 'keyhelddown' ? 'down_hold' : attr === 1 || attr === 'keyreleased' ? 'down_release' : null)
        : sceneNumber === 3 && click === '1x' ? 'config_1x' : null;
    return action ? { nodeId, action, keyAttribute } : null;
  }
  const match = String(scene).toLowerCase().match(/(key\s*)?(\d+)\s*(?:scene)?\s*(?:activated|pressed|released)?/);
  if (!match) return null;
  const number = Number(match[2]) - (integration === 'ozw' ? 1 : 0);
  const actionNames = { 0: 'up_1x', 1: 'up_2x', 2: 'up_3x', 3: 'up_4x', 4: 'up_5x', 5: 'down_1x', 6: 'down_2x', 7: 'down_3x', 8: 'down_4x', 9: 'down_5x', 10: 'config_1x', 11: 'config_2x', 12: 'config_3x' };
  return { nodeId, action: actionNames[number] || ('scene_' + number), keyAttribute };
}

module.exports = function (RED) {
  function SceneManager(config) {
    RED.nodes.createNode(this, config);
    const node = this;
    node.outputs = Number(config.outputs) || (function () {
      try { return utils.resolveSwitchType(config.switchtype || 'lzw31-sn').scene.length; }
      catch (error) { return 1; }
    })();
    node.on('input', function (msg) {
      const integration = config.zwave || 'zwave_js';
      const expected = String(config.node_id || '').trim();
      const result = sceneFromMessage(msg, integration);
      if (!result || (expected && String(result.nodeId) !== expected)) return;
      try {
        const model = utils.resolveSwitchType(config.switchtype || 'lzw31-sn');
        const index = model.scene.indexOf(result.action);
        if (index < 0 || index >= Number(config.outputs || model.scene.length)) return;
        const out = Object.assign({}, msg);
        if (config.passthrough) out.node_id = result.nodeId;
        out.scene = result.action;
        const outputs = new Array(Number(config.outputs || model.scene.length)).fill(null);
        outputs[index] = out;
        node.send(outputs);
        node.status({ fill: 'green', shape: 'dot', text: result.action });
      } catch (error) {
        node.status({ fill: 'red', shape: 'ring', text: error.message });
        node.error(error, msg);
      }
    });
  }
  SceneManager.sceneFromMessage = sceneFromMessage;
  RED.nodes.registerType('inovelli-scene-manager', SceneManager);
};
