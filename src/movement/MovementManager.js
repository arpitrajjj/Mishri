/**
 * Movement Manager — Smooth, human-like movement
 * Actually works with mineflayer-pathfinder
 */

const { goals } = require('mineflayer-pathfinder');

class MovementManager {
  constructor(bot, humanness) {
    this.bot = bot;
    this.h = humanness;
    this.isMoving = false;
    this.wanderInterval = null;
    this.stuckCount = 0;
  }

  /**
   * Find the ground Y at a given x,z by scanning down from Y=320
   */
  _findSurfaceY(x, z) {
    for (let y = 320; y >= -64; y--) {
      const block = this.bot.blockAt(new (require('vec3'))(x, y, z));
      if (block && block.name !== 'air' && block.name !== 'cave_air') {
        return y + 1; // Stand on top of this block
      }
    }
    return Math.floor(this.bot.entity.position.y); // Fallback
  }

  /**
   * Walk to a position with human-like imperfections
   */
  async walkTo(x, y, z) {
    if (this.isMoving) return;
    this.isMoving = true;

    try {
      // Add sub-optimality — offset target slightly
      const offsetX = this.h.addNoise(0, 0.5);
      const offsetZ = this.h.addNoise(0, 0.5);
      const goal = new goals.GoalNear(
        Math.floor(x + offsetX),
        Math.floor(y),
        Math.floor(z + offsetZ),
        1 // Get within 1 block (humans don't stand exactly on the spot)
      );

      // Set the goal and wait for completion
      await this.bot.pathfinder.goto(goal);
      this.stuckCount = 0;

    } catch (err) {
      // Explicit cancellation is not a pathfinding failure.
      if (err.name === 'GoalChanged' || err.name === 'PathStopped') return;
      this.stuckCount++;
      console.log(`[Movement] Pathfinding hiccup (${this.stuckCount}): ${err.message}`);

      // If stuck multiple times, try a simple manual walk
      if (this.stuckCount >= 3) {
        await this._manualWalk(x, z);
        this.stuckCount = 0;
      } else {
        await this.h.delay(2000, 5000);
      }
    } finally {
      this.isMoving = false;
    }
  }

  /**
   * Manual walk fallback — use control states directly
   * When pathfinder fails, walk like a real player would
   */
  async _manualWalk(targetX, targetZ) {
    const pos = this.bot.entity.position;
    const dx = targetX - pos.x;
    const dz = targetZ - pos.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    if (dist < 2) return; // Already close enough

    // Set look toward target
    const yaw = Math.atan2(-dx, dz);
    this.bot.look(yaw, 0, true);

    // Walk forward for a bit
    this.bot.setControlState('forward', true);

    // Sprint sometimes (humans toggle sprint)
    if (dist > 10 && Math.random() < 0.4) {
      this.bot.setControlState('sprint', true);
    }

    // Walk for a random duration (won't reach target, but looks natural)
    const walkTime = Math.min(dist * 200, 5000) + Math.random() * 2000;
    await this.h.delay(walkTime, walkTime + 2000);

    this.bot.setControlState('forward', false);
    this.bot.setControlState('sprint', false);

    // Random jump while walking (humans do this)
    if (Math.random() < 0.2) {
      await this.humanJump();
    }
  }

  /**
   * Wander within a radius — natural exploration
   */
  async wander(radius = 32) {
    const pos = this.bot.entity.position;
    const angle = Math.random() * Math.PI * 2;
    const dist = 5 + Math.random() * radius; // Min 5 blocks so it actually moves

    const tx = Math.floor(pos.x + Math.cos(angle) * dist);
    const tz = Math.floor(pos.z + Math.sin(angle) * dist);

    // Find ground level by scanning blocks
    const ty = this._findSurfaceY(tx, tz);

    await this.walkTo(tx, ty, tz);
  }

  /**
   * Start continuous wandering loop
   */
  startWandering(intervalMin = 10000, intervalMax = 30000) {
    const loop = async () => {
      if (!this.bot.entity || this.isMoving) return;

      await this.h.maybeMicroStop();
      const radius = 16 + Math.random() * 48;
      await this.wander(radius);

      const next = intervalMin + Math.random() * (intervalMax - intervalMin);
      this.wanderInterval = setTimeout(loop, next);
    };

    loop();
  }

  stopWandering() {
    if (this.wanderInterval) {
      clearTimeout(this.wanderInterval);
      this.wanderInterval = null;
    }
    this.bot.pathfinder.setGoal(null);
    this.bot.clearControlStates();
    this.isMoving = false;
  }

  /**
   * Move toward an entity naturally
   */
  async approachEntity(entity, preferredDist = 3) {
    if (!entity?.position) return;

    const dist = this.bot.entity.position.distanceTo(entity.position);
    if (dist <= preferredDist + 1) return;

    // Add slight angle offset so we don't walk in a perfect line
    const dx = entity.position.x - this.bot.entity.position.x;
    const dz = entity.position.z - this.bot.entity.position.z;
    const angle = Math.atan2(dz, dx) + this.h.addNoise(0, 0.3);

    const targetDist = dist - preferredDist;
    const tx = this.bot.entity.position.x + Math.cos(angle) * targetDist;
    const tz = this.bot.entity.position.z + Math.sin(angle) * targetDist;
    const ty = this._findSurfaceY(Math.floor(tx), Math.floor(tz));

    await this.walkTo(Math.floor(tx), ty, Math.floor(tz));
  }

  /**
   * Sprint toggle — humans don't sprint 100% of the time
   */
  async sprintToggled(duration) {
    this.bot.setControlState('sprint', true);
    this.bot.setControlState('forward', true);
    await this.h.delay(duration * 0.6, duration);
    this.bot.setControlState('sprint', false);
    this.bot.setControlState('forward', false);
  }

  /**
   * Jump with human timing
   */
  async humanJump() {
    await this.h.delay(0, 200);
    this.bot.setControlState('jump', true);
    await this.h.delay(300, 600);
    this.bot.setControlState('jump', false);
  }
}

module.exports = MovementManager;
