const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const goto = require('mineflayer-pathfinder/lib/goto');
const MovementManager = require('../src/movement/MovementManager');

function createMovement() {
  const bot = new EventEmitter();
  const goals = [];
  bot.clearControlStates = () => {};
  bot.pathfinder = {
    setGoal(goal, dynamic = false) {
      goals.push({ goal, dynamic });
      bot.emit('goal_updated', goal, dynamic);
    },
    goto(goal) { return goto(bot, goal); },
  };
  const pauses = [];
  const movement = new MovementManager(bot, {
    addNoise: () => 0,
    delay: async (...args) => { pauses.push(args); },
  });
  return { bot, goals, pauses, movement };
}

test('walkTo waits for arrival and does not replace an active walk', async () => {
  const { bot, goals, movement } = createMovement();
  const walking = movement.walkTo(10, 64, 20);
  try {
    await Promise.resolve();
    assert.equal(movement.isMoving, true);
    assert.equal(goals[0].dynamic, false);
    await movement.walkTo(30, 64, 40);
    assert.equal(goals.length, 1);
  } finally {
    bot.emit('goal_reached', goals[0].goal);
    await walking;
  }
  assert.equal(movement.isMoving, false);
});

test('pathfinding failures reach the existing manual fallback after three attempts', async () => {
  const { bot, pauses, movement } = createMovement();
  let fallbacks = 0;
  movement._manualWalk = async () => { fallbacks++; };
  for (let attempt = 0; attempt < 3; attempt++) {
    const walking = movement.walkTo(10, 64, 20);
    bot.emit('path_update', { status: 'noPath', path: [{}] });
    await walking;
  }
  assert.equal(pauses.length, 2);
  assert.equal(fallbacks, 1);
  assert.equal(movement.stuckCount, 0);
  assert.equal(movement.isMoving, false);
});

test('a failed manual fallback releases the movement guard', async () => {
  const { bot, movement } = createMovement();
  movement.stuckCount = 2;
  movement._manualWalk = async () => { throw new Error('manual movement failed'); };
  const walking = movement.walkTo(10, 64, 20);
  bot.emit('path_update', { status: 'noPath', path: [{}] });
  await assert.rejects(walking, /manual movement failed/);
  assert.equal(movement.isMoving, false);
});

test('stopping a walk does not count as being stuck or trigger manual movement', async () => {
  const { movement, pauses } = createMovement();
  let fallbacks = 0;
  movement._manualWalk = async () => { fallbacks++; };
  for (let attempt = 0; attempt < 3; attempt++) {
    const walking = movement.walkTo(10, 64, 20);
    movement.stopWandering();
    await walking;
  }
  assert.equal(fallbacks, 0);
  assert.equal(pauses.length, 0);
  assert.equal(movement.stuckCount, 0);
  assert.equal(movement.isMoving, false);
});
