/**
 * Mishri — Human-like Minecraft Bot
 * "Not a noisy machine. A creature that hesitates, breathes, and forgets."
 */

const path = require('path');
const mineflayer = require('mineflayer');
const pathfinder = require('mineflayer-pathfinder');
const autoEat = require('mineflayer-auto-eat');
const collectBlock = require('mineflayer-collectblock');
const pvp = require('mineflayer-pvp');
const toolPlugin = require('mineflayer-tool');

// Resolve paths relative to this file's directory
// This file is at src/core/MishriBot.js, project root is 2 levels up
const _thisDir = __dirname;
const config = require(path.resolve(_thisDir, '..', '..', 'config', 'default.json'));
const SkinManager = require('./SkinManager');
const HumannessLayer = require(path.resolve(_thisDir, '..', 'humanness', 'HumannessLayer.js'));
const MovementManager = require(path.resolve(_thisDir, '..', 'movement', 'MovementManager.js'));
const PerceptionManager = require(path.resolve(_thisDir, '..', 'perception', 'PerceptionManager.js'));
const SocialManager = require(path.resolve(_thisDir, '..', 'social', 'SocialManager.js'));
const BehaviorOrchestrator = require(path.resolve(_thisDir, '..', 'behavior', 'BehaviorOrchestrator.js'));
const SkillManager = require(path.resolve(_thisDir, '..', 'skills', 'SkillManager.js'));

class MishriBot {
  constructor(overrides = {}) {
    this.config = { ...config, ...overrides };
    // Keep defaults within each section when callers override only some fields.
    for (const section of Object.keys(config)) {
      this.config[section] = { ...config[section], ...this.config[section] };
    }
    this.bot = null;
    this.running = false;
    this.startTime = null;

    // Sub-systems
    this.skin = new SkinManager(this.config.skin);
    this.humanness = new HumannessLayer(this.config.humanness);
    this.movement = null;
    this.perception = null;
    this.social = null;
    this.behavior = null;
    this.skills = null;
  }

  /**
   * Connect to the Minecraft server
   */
  connect() {
    const isMicrosoft = this.config.bot.auth === 'microsoft' || 
                         SkinManager.isMicrosoftAuth(
                           this.config.bot.email,
                           this.config.bot.password
                         );

    const authType = isMicrosoft ? 'microsoft' : (this.config.bot.auth || 'offline');
    const username = isMicrosoft ? (this.config.bot.email || this.config.bot.username) : this.config.bot.username;
    const password = isMicrosoft ? this.config.bot.password : (this.config.bot.password || '');

    console.log(`[Mishri] Connecting as ${isMicrosoft ? this.config.bot.username + ' (Microsoft)' : this.config.bot.username} to ${this.config.server.host}:${this.config.server.port} (v${this.config.server.version})`);

    const botOptions = {
      host: this.config.server.host,
      port: this.config.server.port,
      username: username,
      password: password,
      auth: authType,
      version: this.config.server.version,
      hideErrors: false,
    };

    // Only inject skin for offline auth (Microsoft auth uses the premium skin)
    if (!isMicrosoft) {
      const skinProps = this.skin.getProfileProperties();
      if (skinProps) {
        botOptions.profileProperties = skinProps;
        console.log('[Mishri] Custom skin will be applied (offline auth)');
      }
    } else {
      console.log('[Mishri] Using Microsoft auth — premium skin will be used automatically');
    }

    this.bot = mineflayer.createBot(botOptions);

    // Also inject skin via packet hook (offline only)
    if (!isMicrosoft) {
      this.skin.injectSkin(this.bot);
    }

    // Load plugins
    this.bot.loadPlugin(pathfinder.pathfinder);
    this.bot.loadPlugin(autoEat.loader);
    this.bot.loadPlugin(collectBlock.plugin);
    this.bot.loadPlugin(pvp.plugin);
    this.bot.loadPlugin(toolPlugin.plugin);

    // Initialize sub-systems
    this.movement = new MovementManager(this.bot, this.humanness);
    this.perception = new PerceptionManager(this.bot, this.humanness);
    this.social = new SocialManager(this.bot, this.humanness, this.config);
    this.behavior = new BehaviorOrchestrator(this.bot, this.humanness, this);
    this.skills = new SkillManager(this.bot, this.humanness);

    // Wire up events
    this._registerEvents();

    return this;
  }

  /**
   * Register all event handlers
   */
  _registerEvents() {
    this.bot.once('spawn', () => {
      console.log('[Mishri] Spawned in world!');
      this.running = true;
      this.startTime = Date.now();
      this._onSpawn();
    });

    this.bot.on('chat', (username, message) => {
      if (username === this.bot.username) return;
      this.humanness.onInterestingEvent();
      this.social.onChat(username, message);
    });

    this.bot.on('health', () => {
      this.perception.onHealthChange();
    });

    this.bot.on('entityHurt', (entity) => {
      this.perception.onEntityHurt(entity);
      // If WE got hurt, get startled
      if (entity === this.bot.entity) {
        this.humanness.getStartled();
      }
    });

    this.bot.on('entitySwing', (entity) => {
      this.perception.onEntitySwing(entity);
    });

    this.bot.on('playerJoined', (player) => {
      console.log(`[Mishri] ${player.username} joined`);
      this.humanness.onInterestingEvent();
      // Maybe greet them after a delay
      if (Math.random() < 0.4) {
        this.humanness.delay(3000, 8000).then(() => {
          this.social.onChat(player.username, 'just joined');
        });
      }
    });

    this.bot.on('playerLeft', (player) => {
      console.log(`[Mishri] ${player.username} left`);
    });

    this.bot.on('kicked', (reason) => {
      console.log(`[Mishri] Kicked: ${reason}`);
      this.running = false;
    });

    this.bot.on('error', (err) => {
      console.log(`[Mishri] Error: ${err.message}`);
    });

    this.bot.on('end', () => {
      console.log('[Mishri] Disconnected.');
      this.running = false;
    });

    this.bot.on('death', () => {
      this._onDeath();
    });

    // Periodic humanness behaviors
    this.bot.on('physicsTick', () => {
      if (Math.random() < 0.002) { // ~every 50 seconds
        this._periodicHumanness();
      }
    });
  }

  /**
   * Called when the bot spawns
   */
  async _onSpawn() {
    await this.humanness.delay(2000, 5000);
    this.social.maybeGreet();

    this.behavior.start();
    this.perception.startLookLoop();
    this.behavior.startAFKSimulator();

    // Start the periodic state logger
    this._startStateLogger();

    console.log('[Mishri] All systems online. Blending in...');
  }

  /**
   * Periodic humanness behaviors — little things that make us look alive
   */
  async _periodicHumanness() {
    if (!this.running || !this.bot.entity) return;

    // Scroll hotbar aimlessly
    await this.humanness.maybeScrollHotbar(this.bot);

    // Sneak peek
    await this.humanness.maybeSneakPeek(this.bot);

    // Fidget with held item
    await this.humanness.maybeFidgetItem(this.bot);

    // Check inventory briefly
    await this.humanness.maybeCheckInventory(this.bot);

    // Nervous look around (in dark, after damage)
    await this.humanness.nervousLookAround(this.bot);
  }

  /**
   * Handle death like a human
   */
  async _onDeath() {
    console.log('[Mishri] Died! Respawning...');
    this.humanness.getStartled();
    await this.humanness.delay(1500, 5000);

    const deathMessages = ['rip', 'oof', 'bruh', 'that was dumb', 'lag', 'ouch'];
    this.bot.chat(this.humanness.pick(deathMessages));
    await this.humanness.delay(500, 2000);
    this.bot.respawn();
  }

  /**
   * Log internal state periodically
   */
  _startStateLogger() {
    setInterval(() => {
      if (!this.running) return;
      const state = this.humanness.getState();
      const uptime = Math.round((Date.now() - this.startTime) / 60000);
      console.log(`[Mishri] State: ${JSON.stringify(state)} | Uptime: ${uptime}m | Behavior: ${this.behavior.currentBehavior || 'none'}`);
    }, 300000); // Every 5 minutes
  }

  /**
   * Disconnect gracefully
   */
  async disconnect() {
    this.running = false;

    // Say goodbye like a human
    if (this.bot?.entity) {
      const farewells = ['cya', 'gotta go', 'later', 'im out', 'bye'];
      this.bot.chat(this.humanness.pick(farewells));
      await this.humanness.delay(1000, 3000);
    }

    this.behavior?.stop();
    this.perception?.stop();
    this.bot?.quit();
    console.log('[Mishri] Disconnected.');
  }
}

// --- CLI ---
if (require.main === module) {
  const bot = new MishriBot();
  bot.connect();

  process.on('SIGINT', async () => {
    await bot.disconnect();
    process.exit(0);
  });
}

module.exports = MishriBot;
