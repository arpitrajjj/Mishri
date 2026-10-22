const assert = require('node:assert/strict');
const test = require('node:test');
const mcData = require('minecraft-data')('1.21.11');
const injectCrafting = require('mineflayer/lib/plugins/craft');
const SkillManager = require('../src/skills/SkillManager');

function createSkills(items = {}) {
  const bot = {
    registry: mcData,
    inventory: {
      count(id) { return items[mcData.items[id]?.name] || 0; },
    },
  };
  // Use Mineflayer's real inventory-aware recipe queries.
  injectCrafting(bot);
  const crafts = [];
  bot.craft = async (...args) => { crafts.push(args); };
  let interestingEvents = 0;
  const skills = new SkillManager(bot, {
    delay: async () => {},
    onInterestingEvent: () => { interestingEvents++; },
  });
  return { bot, skills, crafts, get interestingEvents() { return interestingEvents; } };
}

test('craftBasic turns an available log into planks', async () => {
  const fixture = createSkills({ oak_log: 1 });
  await fixture.skills.craftBasic();
  assert.equal(fixture.crafts.length, 1);
  const [recipe, count, table] = fixture.crafts[0];
  assert.equal(recipe.result.id, mcData.itemsByName.oak_planks.id);
  assert.equal(recipe.result.count, 4);
  assert.equal(count, 1);
  assert.equal(table, null);
  assert.equal(fixture.interestingEvents, 1);
});

test('craftBasic does nothing without available ingredients', async () => {
  const fixture = createSkills();
  await fixture.skills.craftBasic();
  assert.equal(fixture.crafts.length, 0);
  assert.equal(fixture.interestingEvents, 0);
});

test('craftBasic chooses only recipes available without a crafting table', async () => {
  const fixture = createSkills({ oak_planks: 3, stick: 2 });
  // The materials are sufficient for a wooden pickaxe, but it needs a table.
  assert.equal(fixture.bot.recipesFor(mcData.itemsByName.wooden_pickaxe.id, null, 1, null).length, 0);
  await fixture.skills.craftBasic();
  assert.equal(fixture.crafts.length, 1);
  const recipe = fixture.crafts[0][0];
  assert.equal(recipe.requiresTable, false);
  for (const ingredient of recipe.delta.filter(item => item.count < 0)) {
    assert(fixture.bot.inventory.count(ingredient.id) >= -ingredient.count);
  }
});

test('a failed craft does not report a completed activity', async () => {
  const fixture = createSkills({ oak_log: 1 });
  fixture.bot.craft = async () => { throw new Error('inventory changed'); };
  await fixture.skills.craftBasic();
  assert.equal(fixture.interestingEvents, 0);
});
