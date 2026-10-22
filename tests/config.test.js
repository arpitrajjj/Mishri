const assert = require('node:assert/strict');
const { beforeEach, test } = require('node:test');
const defaults = require('../config/default.json');
const HumannessLayer = require('../src/humanness/HumannessLayer');
const MishriBot = require('../src/core/MishriBot');

beforeEach(t => {
  // Configuration tests do not need the background mood timers.
  t.mock.method(HumannessLayer.prototype, '_startMoodCycles', () => {});
});

test('a host-only override preserves the server port and protocol version', () => {
  const mishri = new MishriBot({ server: { host: 'example.test' } });
  assert.deepEqual(mishri.config.server, { ...defaults.server, host: 'example.test' });
});

test('partial overrides preserve the remaining defaults in every section', () => {
  const overrides = {
    server: { port: 25566 },
    bot: { username: 'TestBot' },
    skin: { enabled: false },
    humanness: { maxAPM: 30 },
    personality: { talkativeness: 0 },
    activities: { enableMining: false },
    llm: { enabled: true },
  };
  const mishri = new MishriBot(overrides);
  for (const section of Object.keys(defaults)) {
    assert.deepEqual(mishri.config[section], { ...defaults[section], ...overrides[section] });
  }
  assert.equal(mishri.humanness.config.lookWanderIntervalMin, defaults.humanness.lookWanderIntervalMin);
  assert.equal(mishri.skin.enabled, false);
});

test('explicit arrays replace the defaults and unknown top-level options survive', () => {
  const mishri = new MishriBot({ personality: { greetings: ['hello'] }, customOption: 42 });
  assert.deepEqual(mishri.config.personality.greetings, ['hello']);
  assert.deepEqual(mishri.config.personality.farewells, defaults.personality.farewells);
  assert.equal(mishri.config.customOption, 42);
});

test('changing an instance section does not change defaults or another instance', t => {
  const originalHost = defaults.server.host;
  t.after(() => { defaults.server.host = originalHost; });
  const first = new MishriBot();
  first.config.server.host = 'changed.test';
  const second = new MishriBot();
  assert.equal(defaults.server.host, originalHost);
  assert.equal(second.config.server.host, originalHost);
});

test('instance configuration does not mutate the supplied section objects', () => {
  const overrides = { server: { host: 'example.test' } };
  const mishri = new MishriBot(overrides);
  mishri.config.server.port = 25566;
  assert.deepEqual(overrides, { server: { host: 'example.test' } });
});
