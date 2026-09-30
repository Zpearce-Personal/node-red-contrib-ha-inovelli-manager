'use strict';

const assert = require('assert');
const path = require('path');
const helper = require('node-red-node-test-helper');
const utils = require('../nodes/lib/inovelli-utils');
const notification = path.join(__dirname, '../nodes/inovelli-notification-manager/inovelli-notification-manager.js');
const led = path.join(__dirname, '../nodes/inovelli-led-manager/inovelli-led-manager.js');
const scene = path.join(__dirname, '../nodes/inovelli-scene-manager/inovelli-scene-manager.js');

helper.init(require.resolve('node-red'));

function load(file, flow) {
  return new Promise((resolve, reject) => helper.load(require(file), flow, error => error ? reject(error) : resolve()));
}
function unload() { return new Promise(resolve => helper.unload().then(resolve)); }

async function test(name, run) {
  try { await run(); process.stdout.write('ok - ' + name + '\n'); }
  catch (error) { process.stderr.write('not ok - ' + name + '\n' + error.stack + '\n'); process.exitCode = 1; }
  finally { await unload(); }
}

async function main() {
  await new Promise((resolve, reject) => helper.startServer(error => error ? reject(error) : resolve()));
  await test('registers notification manager', async () => {
    await load(notification, [{ id: 'n1', type: 'inovelli-notification-manager', wires: [[]] }]);
    assert(helper.getNode('n1'));
  });
  await test('registers LED manager', async () => {
    await load(led, [{ id: 'n1', type: 'inovelli-led-manager', wires: [[]] }]);
    assert(helper.getNode('n1'));
  });
  await test('registers scene manager with switch output count', async () => {
    await load(scene, [{ id: 'n1', type: 'inovelli-scene-manager', switchtype: 'lzw36', outputs: 16, wires: Array.from({ length: 16 }, () => []) }]);
    assert(helper.getNode('n1'));
    assert.strictEqual(helper.getNode('n1').outputs, 16);
  });
  await test('parses hue RGB name and hex colors', async () => {
    assert.strictEqual(utils.parseHue(120), 85);
    assert.strictEqual(utils.parseHue([255, 0, 0]), 0);
    assert.strictEqual(utils.parseHue('red'), 0);
    assert.strictEqual(utils.parseHue('#00ff00'), 85);
  });
  await test('encodes notification duration strings', async () => {
    assert.strictEqual(utils.parseDuration('47 seconds'), 47);
    assert.strictEqual(utils.parseDuration('2 minutes'), 62);
    assert.strictEqual(utils.parseDuration('2 hours'), 122);
    assert.strictEqual(utils.parseDuration('2 days'), 168);
    assert.strictEqual(utils.parseDuration(999), 255);
    assert.strictEqual(utils.parseDuration(0), 1);
  });
  await test('resolves switch type aliases and integers', async () => {
    assert.strictEqual(utils.resolveSwitchType('LZW31-SN').key, 'lzw31-sn');
    assert.strictEqual(utils.resolveSwitchType('Dimmer').key, 'dimmer');
    assert.strictEqual(utils.resolveSwitchType('FAN').key, 'fan');
    assert.strictEqual(utils.resolveSwitchType(16).effectParameter, 16);
  });
  await test('applies notification and LED payload overrides', async () => {
    const notificationFlow = [
      { id: 'n1', type: 'inovelli-notification-manager', zwave: 'zwave_js', entity_id: 'light.old', switchtype: 'lzw31-sn', duration: '1 second', wires: [['h1']] },
      { id: 'h1', type: 'helper' }
    ];
    await load(notification, notificationFlow);
    const receivedNotification = new Promise(resolve => helper.getNode('h1').on('input', resolve));
    helper.getNode('n1').receive({ payload: { zwave: 'ozw', node_id: 22, entity_id: 'light.new', switchtype: 'lzw31-sn', color: '#00ff00', brightness: 5, duration: '2 minutes', effect: 'pulse', multicast: true } });
    const notificationMessage = await receivedNotification;
    assert.strictEqual(notificationMessage.payload.domain, 'zwave');
    assert.strictEqual(notificationMessage.payload.data.node_id, 22);
    assert.strictEqual(notificationMessage.payload.data.parameter, 16);
    assert.strictEqual(notificationMessage.payload.data.value, 85);
    await unload();
    const ledFlow = [{ id: 'n1', type: 'inovelli-led-manager', zwave: 'zwave_js', entity_id: 'light.old', switchtype: 'lzw31-sn', wires: [['h1']] }, { id: 'h1', type: 'helper' }];
    await load(led, ledFlow);
    const receivedLed = new Promise(resolve => helper.getNode('h1').on('input', resolve));
    helper.getNode('n1').receive({ payload: { entity_id: 'light.new', color: 180, brightness: 4, brightnessOff: 2 } });
    const ledMessage = await receivedLed;
    assert.strictEqual(ledMessage.payload.data.entity_id, 'light.new');
    assert.strictEqual(ledMessage.payload.data.value, 128);
  });
  await test('routes supported scene events and passthrough', async () => {
    await load(scene, [{ id: 'n1', type: 'inovelli-scene-manager', zwave: 'zwave_js', node_id: '12', switchtype: 'lzw31-sn', passthrough: true, outputs: 15, wires: Array.from({ length: 15 }, () => ['h1']) }, { id: 'h1', type: 'helper' }]);
    const received = new Promise(resolve => helper.getNode('h1').on('input', resolve));
    helper.getNode('n1').receive({ payload: { event: { node_id: 12, args: { scene: 1, keyAttribute: 0 } } } });
    const result = await received;
    assert.strictEqual(result.scene, 'up_1x');
    assert.strictEqual(result.node_id, 12);
    await unload();
    await load(scene, [{ id: 'n1', type: 'inovelli-scene-manager', zwave: 'ozw', node_id: '12', switchtype: 'lzw30-sn', passthrough: true, outputs: 13, wires: Array.from({ length: 13 }, () => ['h1']) }, { id: 'h1', type: 'helper' }]);
    const receivedOzw = new Promise(resolve => helper.getNode('h1').on('input', resolve));
    helper.getNode('n1').receive({ payload: { event: { node_id: 12, scene_id: 1 } } });
    const ozwResult = await receivedOzw;
    assert.strictEqual(ozwResult.scene, 'up_1x');
    assert.strictEqual(ozwResult.node_id, 12);
  });
  helper.stopServer();
}

main().catch(error => { process.stderr.write(error.stack + '\n'); process.exitCode = 1; helper.stopServer(); });
