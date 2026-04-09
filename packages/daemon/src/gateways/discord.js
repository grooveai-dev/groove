// GROOVE — Discord Gateway (discord.js)
// FSL-1.1-Apache-2.0 — see LICENSE

import { BaseGateway } from './base.js';
import { truncate, statusEmoji, formatTokens, formatDuration } from './formatter.js';

// Embed colors (decimal)
const COLORS = {
  success: 0x2ecc71,
  danger: 0xe74c3c,
  warning: 0xf39c12,
  info: 0x3498db,
  accent: 0x5865f2, // Discord blurple
};

export class DiscordGateway extends BaseGateway {
  static type = 'discord';
  static displayName = 'Discord';
  static description = 'Discord bot for notifications and agent commands';
  static credentialKeys = [
    { key: 'bot_token', label: 'Bot Token', required: true, help: 'Discord Developer Portal \u2192 Bot \u2192 Token' },
  ];

  constructor(daemon, config) {
    super(daemon, config);
    this.client = null;
    this.channel = null;
    this._djs = null; // cached discord.js module
  }

  async connect() {
    const token = this._getCredential('bot_token');
    if (!token) throw new Error('Discord bot token not configured');

    try {
      this._djs = await import('discord.js');
    } catch {
      throw new Error('Discord gateway requires discord.js. Install with: npm i discord.js');
    }

    const { Client, GatewayIntentBits } = this._djs;

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
    });

    // Handle incoming messages (commands)
    this.client.on('messageCreate', async (msg) => {
      if (msg.author.bot) return;
      if (!msg.content.startsWith('/')) return;

      const userId = msg.author.id;
      const [rawCmd, ...args] = msg.content.slice(1).split(/\s+/);
      const command = rawCmd.toLowerCase();

      // Auto-capture channelId
      if (!this.config.chatId) {
        this.config.chatId = msg.channel.id;
        this.daemon.gateways._save(this.config.id);
      }

      const response = await this.handleCommand(command, args, userId);
      if (response) {
        await msg.channel.send(this._buildReply(response));
      }
    });

    // Handle button interactions (approve/reject)
    this.client.on('interactionCreate', async (interaction) => {
      if (!interaction.isButton()) return;

      const userId = interaction.user.id;
      if (!this._isAuthorized(userId)) {
        await interaction.reply({ content: 'Unauthorized.', ephemeral: true });
        return;
      }

      const [action, ...rest] = interaction.customId.split(':');
      const approvalId = rest.join(':');
      if (!approvalId) {
        await interaction.reply({ content: 'Invalid action.', ephemeral: true });
        return;
      }

      try {
        let responseText;
        if (action === 'approve') {
          this.daemon.supervisor.approve(approvalId);
          responseText = `\u2705 Approved: ${approvalId}`;
        } else if (action === 'reject') {
          this.daemon.supervisor.reject(approvalId);
          responseText = `\u274c Rejected: ${approvalId}`;
        } else {
          await interaction.reply({ content: 'Unknown action.', ephemeral: true });
          return;
        }

        // Update the original message — remove buttons, add resolution
        await interaction.update({
          components: [],
          embeds: [
            ...(interaction.message.embeds || []),
            this._embed({ description: responseText, color: action === 'approve' ? COLORS.success : COLORS.danger }),
          ],
        });
      } catch (err) {
        await interaction.reply({ content: `Error: ${err.message}`, ephemeral: true }).catch(() => {});
      }
    });

    await this.client.login(token);

    // Resolve target channel
    if (this.config.chatId) {
      try {
        this.channel = await this.client.channels.fetch(this.config.chatId);
      } catch { /* channel will be set on first message */ }
    }

    this.connected = true;
    console.log(`[Groove:Discord] Connected as ${this.client.user.tag}`);
  }

  async disconnect() {
    if (this.client) {
      this.client.destroy();
      this.client = null;
    }
    this.channel = null;
    this.connected = false;
    this._djs = null;
    console.log('[Groove:Discord] Disconnected');
  }

  async send(text, options = {}) {
    const ch = await this._resolveChannel();
    if (!ch) return;

    const payload = {};

    // Build embed for rich notifications
    if (options.approvalId) {
      // Approval request — embed with action buttons
      payload.embeds = [this._embed({
        title: '\ud83d\udea8 Approval Required',
        description: text,
        color: COLORS.warning,
      })];
      payload.components = [this._approvalButtons(options.approvalId)];
    } else if (options.embed) {
      payload.embeds = [options.embed];
    } else {
      // Plain text — truncate to Discord's 2000 char limit
      payload.content = truncate(text, 2000);
    }

    await ch.send(payload);
  }

  getStatus() {
    return {
      ...super.getStatus(),
      botTag: this.client?.user?.tag || null,
    };
  }

  // -------------------------------------------------------------------
  // Discord-Specific Helpers
  // -------------------------------------------------------------------

  async _resolveChannel() {
    if (!this.channel && this.config.chatId && this.client) {
      try {
        this.channel = await this.client.channels.fetch(this.config.chatId);
      } catch { return null; }
    }
    return this.channel;
  }

  /**
   * Build a discord.js EmbedBuilder-compatible plain object.
   */
  _embed({ title, description, color, fields, footer }) {
    const embed = { color: color || COLORS.accent };
    if (title) embed.title = title;
    if (description) embed.description = truncate(description, 4096);
    if (fields) embed.fields = fields;
    if (footer) embed.footer = { text: footer };
    embed.timestamp = new Date().toISOString();
    return embed;
  }

  /**
   * Build an ActionRow with Approve/Reject buttons.
   */
  _approvalButtons(approvalId) {
    if (!this._djs) return {};
    const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = this._djs;
    return new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`approve:${approvalId}`).setLabel('Approve').setStyle(ButtonStyle.Success).setEmoji('\u2705'),
      new ButtonBuilder().setCustomId(`reject:${approvalId}`).setLabel('Reject').setStyle(ButtonStyle.Danger).setEmoji('\u274c'),
    );
  }

  /**
   * Build a reply payload from a command response.
   */
  _buildReply(response) {
    if (!response) return {};
    // Wrap command responses in a code block for readability
    const text = response.text || '';
    if (text.length > 1900) {
      return { content: '```\n' + truncate(text, 1900) + '\n```' };
    }
    return { content: '```\n' + text + '\n```' };
  }
}
