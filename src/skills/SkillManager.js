/**
 * Skill Manager — Actually functional skills (with human imperfection!)
 * Mining, eating, crafting, building — the bot can DO things now
 */

class SkillManager {
  constructor(bot, humanness) {
    this.bot = bot;
    this.h = humanness;
  }

  /**
   * Mine a random nearby block — imperfectly
   */
  async mineRandom() {
    const pos = this.bot.entity.position;
    const radius = 5;
    const targets = [];

    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dz = -radius; dz <= radius; dz++) {
          try {
            const block = this.bot.blockAt(pos.offset(dx, dy, dz));
            if (block && block.name !== 'air' && block.name !== 'cave_air' && this.bot.canDigBlock(block)) {
              targets.push(block);
            }
          } catch (e) { /* skip invalid positions */ }
        }
      }
    }

    if (targets.length === 0) {
      console.log('[Skill] No mineable blocks nearby');
      return;
    }

    // Don't always pick the closest — humans are sub-optimal
    const target = targets[Math.floor(Math.random() * Math.min(targets.length, 8))];

    try {
      // Look at the block first (human would)
      await this.h.smoothTurn(
        this.bot,
        this._getYawTo(target.position.offset(0.5, 0.5, 0.5)),
        this._getPitchTo(target.position.offset(0.5, 0.5, 0.5)),
        6
      );

      // Hesitate before mining
      await this.h.delay(300, 1500);

      // Equip best tool (with inventory fumble delay)
      await this.h.delay(500, 1500);
      try {
        const tool = this.bot.pathfinder.bestHarvestTool(target);
        if (tool) {
          await this.bot.equip(tool, 'hand');
        }
      } catch (e) {
        // Tool equipping can fail, just mine with hand
      }

      // Mine the block
      await this.bot.dig(target, true);
      this.h.onInterestingEvent();

      // Sometimes mine an adjacent block too (humans keep going)
      if (Math.random() < 0.3) {
        const adjacent = targets.find(t =>
          t !== target &&
          Math.abs(t.position.x - target.position.x) <= 1 &&
          Math.abs(t.position.y - target.position.y) <= 1 &&
          Math.abs(t.position.z - target.position.z) <= 1
        );
        if (adjacent && this.bot.canDigBlock(adjacent)) {
          await this.h.delay(200, 800);
          await this.bot.dig(adjacent, true);
        }
      }

    } catch (err) {
      console.log(`[Skill] Mining failed: ${err.message}`);
    }
  }

  /**
   * Eat food — at imperfect hunger levels
   */
  async eatFood() {
    // Humans eat at ~7-9 hunger, not at 0
    if (this.bot.food > 18) return;
    if (this.bot.food > 12 && Math.random() < 0.7) return;

    const foodItem = this.bot.inventory.items().find((item) =>
      item.name.includes('bread') ||
      item.name.includes('cooked') ||
      item.name.includes('apple') ||
      item.name.includes('meat') ||
      item.name.includes('beef') ||
      item.name.includes('pork') ||
      item.name.includes('fish') ||
      item.name.includes('carrot') ||
      item.name.includes('potato') ||
      item.name.includes('melon')
    );

    if (!foodItem) return;

    try {
      await this.h.delay(500, 2000); // Fumble in inventory
      await this.bot.equip(foodItem, 'hand');
      await this.h.delay(200, 600); // Bring to mouth
      await this.bot.consume();
      console.log(`[Skill] Ate ${foodItem.name} (hunger: ${this.bot.food})`);
    } catch (err) {
      console.log(`[Skill] Eating failed: ${err.message}`);
    }
  }

  /**
   * Craft a basic item — with fumbling delays
   */
  async craftBasic() {
    try {
      // Recipe queries require a result item ID. Only include recipes whose
      // ingredients are available in the inventory and that need no table.
      const craftable = this.bot.registry.itemsArray.flatMap(item =>
        this.bot.recipesFor(item.id, null, 1, null)
      );

      if (craftable.length === 0) {
        console.log('[Skill] Nothing to craft');
        return;
      }

      // Pick a random simple recipe
      const recipe = craftable[Math.floor(Math.random() * Math.min(craftable.length, 10))];

      // Human fumble: open inventory multiple times
      await this.h.delay(1000, 3000);
      if (Math.random() < 0.15) {
        await this.h.delay(500, 1500);
      }

      await this.bot.craft(recipe, 1, null);
      await this.h.delay(500, 1500);
      console.log(`[Skill] Crafted: ${recipe.result?.name || 'something'}`);
      this.h.onInterestingEvent();

    } catch (err) {
      console.log(`[Skill] Crafting failed: ${err.message}`);
    }
  }

  /**
   * Place a block from inventory — sometimes the wrong one
   */
  async placeBlock() {
    try {
      // Find a placeable block in inventory
      const blockItem = this.bot.inventory.items().find(item => {
        const mcData = require('minecraft-data')(this.bot.version);
        return mcData.blocksByName[item.name] !== undefined;
      });

      if (!blockItem) {
        console.log('[Skill] No blocks to place');
        return;
      }

      await this.bot.equip(blockItem, 'hand');
      await this.h.delay(300, 800);

      // Find a reference block to place against (the one we're standing on)
      const below = this.bot.blockAt(this.bot.entity.position.offset(0, -1, 0));
      if (!below) return;

      // Place on top of it
      const face = { x: 0, y: 1, z: 0 };
      await this.bot.placeBlock(below, face);

      // 3% chance: place wrong block, then fix
      if (Math.random() < 0.03) {
        console.log('[Skill] Wrong block placed! Fixing...');
        await this.h.delay(1000, 3000);
        const wrongBlock = this.bot.blockAt(below.position.offset(face.x, face.y, face.z));
        if (wrongBlock) {
          await this.bot.dig(wrongBlock);
        }
      }

      this.h.onInterestingEvent();

    } catch (err) {
      console.log(`[Skill] Placing failed: ${err.message}`);
    }
  }

  /**
   * Chop a tree — find and mine log blocks
   */
  async chopTree() {
    const pos = this.bot.entity.position;
    const radius = 10;
    let logBlock = null;

    // Find nearest log
    for (let dx = -radius; dx <= radius && !logBlock; dx++) {
      for (let dy = -3; dy <= 10 && !logBlock; dy++) {
        for (let dz = -radius; dz <= radius && !logBlock; dz++) {
          const block = this.bot.blockAt(pos.offset(dx, dy, dz));
          if (block && (block.name.includes('log') || block.name.includes('stem'))) {
            if (this.bot.canDigBlock(block)) {
              logBlock = block;
            }
          }
        }
      }
    }

    if (!logBlock) {
      console.log('[Skill] No trees nearby');
      return;
    }

    try {
      // Walk near the tree first
      await this.h.smoothTurn(
        this.bot,
        this._getYawTo(logBlock.position),
        this._getPitchTo(logBlock.position),
        6
      );

      await this.h.delay(500, 1500);

      // Equip axe
      try {
        const axe = this.bot.inventory.items().find(i =>
          i.name.includes('axe') || i.name.includes('_axe')
        );
        if (axe) await this.bot.equip(axe, 'hand');
      } catch (e) {}

      await this.bot.dig(logBlock, true);
      console.log(`[Skill] Chopped: ${logBlock.name}`);
      this.h.onInterestingEvent();

    } catch (err) {
      console.log(`[Skill] Chopping failed: ${err.message}`);
    }
  }

  // --- Helpers ---

  _getYawTo(pos) {
    const dx = pos.x - this.bot.entity.position.x;
    const dz = pos.z - this.bot.entity.position.z;
    return Math.atan2(-dx, dz);
  }

  _getPitchTo(pos) {
    const dx = pos.x - this.bot.entity.position.x;
    const dy = pos.y - this.bot.entity.position.y;
    const dz = pos.z - this.bot.entity.position.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    return Math.atan2(-dy, dist);
  }
}

module.exports = SkillManager;
