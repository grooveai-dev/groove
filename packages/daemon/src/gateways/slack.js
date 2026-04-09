// GROOVE — Slack Gateway (@slack/bolt Socket Mode)
// FSL-1.1-Apache-2.0 — see LICENSE

import { BaseGateway } from './base.js';
import { truncate } from './formatter.js';

export class SlackGateway extends BaseGateway {
  static type = 'slack';
  static displayName = 'Slack';
  static description = 'Slack bot for notifications and agent commands';
  static credentialKeys = [
    { key: 'bot_token', label: 'Bot Token (xoxb-...)', required: true, help: 'Slack App \u2192 OAuth & Permissions' },
    { key: 'app_token', label: 'App Token (xapp-...)', required: true, help: 'Socket Mode requires an app-level token' },
  ];

  constructor(daemon, config) {
    super(daemon, config);
    this.app = null;
  }

  async connect() {
    const botToken = this._getCredential('bot_token');
    const appToken = this._getCredential('app_token');
    if (!botToken) throw new Error('Slack bot token not configured');
    if (!appToken) throw new Error('Slack app token not configured (required for Socket Mode)');

    let App;
    try {
      const bolt = await import('@slack/bolt');
      App = bolt.default?.App || bolt.App;
    } catch {
      throw new Error('Slack gateway requires @slack/bolt. Install with: npm i @slack/bolt');
    }

    this.app = new App({
      token: botToken,
      appToken,
      socketMode: true,
      // Log all incoming events for debugging
      logLevel: 'DEBUG',
    });

    // Global error handler — prevent crashes
    this.app.error(async (error) => {
      console.log(`[Groove:Slack] App error: ${error.message}`);
    });

    // Catch-all: log every single event that comes through
    this.app.use(async ({ event, body, next }) => {
      console.log(`[Groove:Slack] Event received — type: ${body?.event?.type || body?.type || 'unknown'}, text: ${body?.event?.text?.slice(0, 50) || 'none'}`);
      await next();
    });

    // Handle @mentions of the bot — primary way to interact
    this.app.event('app_mention', async ({ event, say }) => {
      try {
        console.log(`[Groove:Slack] Mention received:`, JSON.stringify({ text: event.text, user: event.user, channel: event.channel }));
        if (!event.text) return;

        // Auto-capture channelId
        if (!this.config.chatId) {
          this.config.chatId = event.channel;
          this.daemon.gateways._save(this.config.id);
          console.log(`[Groove:Slack] Auto-captured channel: ${this.config.chatId}`);
        }

        // Strip the bot mention to get the command
        const text = event.text.replace(/<@[A-Z0-9]+>/g, '').trim();

        if (!text) {
          await say('\u2705 Groove connected to this channel! Commands: `status`, `agents`, `spawn <role>`, `kill <id>`, `approve <id>`, `help`');
          return;
        }

        // Parse command — no / prefix needed when mentioning
        const [command, ...args] = text.split(/\s+/);
        const response = await this.handleCommand(command, args, event.user);
        if (response) {
          await say(this._buildReply(response));
        }
      } catch (err) {
        console.log(`[Groove:Slack] Mention handler error: ${err.message}`);
        try { await say(`Error: ${err.message}`); } catch { /* ignore */ }
      }
    });

    // Handle direct messages to the bot
    this.app.message(async ({ message, say }) => {
      try {
        console.log(`[Groove:Slack] Message received:`, JSON.stringify({ text: message.text, user: message.user, channel: message.channel, bot_id: message.bot_id, subtype: message.subtype }));
        if (!message.text || message.bot_id || message.subtype) return;

        // Auto-capture channelId from DMs or channels
        if (!this.config.chatId) {
          this.config.chatId = message.channel;
          this.daemon.gateways._save(this.config.id);
          console.log(`[Groove:Slack] Auto-captured channel: ${this.config.chatId}`);
          await say('\u2705 Groove connected to this channel! Commands: `status`, `agents`, `spawn <role>`, `kill <id>`, `approve <id>`, `help`');
        }

        // In Slack, / is reserved for slash commands — use plain text commands instead
        const text = message.text.trim();
        if (!text) return;

        // Strip leading / if someone tries it anyway
        const cleaned = text.startsWith('/') ? text.slice(1) : text;
        const [command, ...args] = cleaned.split(/\s+/);

        // Only respond to known commands
        const known = ['status', 'agents', 'spawn', 'kill', 'approve', 'reject', 'rotate', 'teams', 'schedules', 'help'];
        if (!known.includes(command)) return; // Not a command, ignore

        const response = await this.handleCommand(command, args, message.user);
        if (response) {
          await say(this._buildReply(response));
        }
      } catch (err) {
        console.log(`[Groove:Slack] Message handler error: ${err.message}`);
        try { await say(`Error: ${err.message}`); } catch { /* ignore */ }
      }
    });

    // Handle approve button action
    this.app.action('groove_approve', async ({ action, ack, respond }) => {
      await ack();
      const approvalId = action.value;
      try {
        this.daemon.supervisor.approve(approvalId);
        await respond({
          replace_original: true,
          text: `\u2705 Approved: ${approvalId}`,
          blocks: [
            { type: 'section', text: { type: 'mrkdwn', text: `\u2705 *Approved:* \`${approvalId}\`` } },
          ],
        });
      } catch (err) {
        await respond({ text: `Error: ${err.message}` });
      }
    });

    // Handle reject button action
    this.app.action('groove_reject', async ({ action, ack, respond }) => {
      await ack();
      const approvalId = action.value;
      try {
        this.daemon.supervisor.reject(approvalId);
        await respond({
          replace_original: true,
          text: `\u274c Rejected: ${approvalId}`,
          blocks: [
            { type: 'section', text: { type: 'mrkdwn', text: `\u274c *Rejected:* \`${approvalId}\`` } },
          ],
        });
      } catch (err) {
        await respond({ text: `Error: ${err.message}` });
      }
    });

    // Bolt's auth.test can throw as unhandled rejection — catch it
    const startPromise = this.app.start().catch((err) => {
      throw new Error(`Slack connection failed: ${err.message}`);
    });

    try {
      await startPromise;
    } catch (err) {
      this.app = null;
      throw err;
    }

    this.connected = true;
    console.log('[Groove:Slack] Connected via Socket Mode');
  }

  async disconnect() {
    if (this.app) {
      try { await this.app.stop(); } catch { /* ignore */ }
      this.app = null;
    }
    this.connected = false;
    console.log('[Groove:Slack] Disconnected');
  }

  async send(text, options = {}) {
    if (!this.app) return;
    if (!this.config.chatId) throw new Error('No channel configured. Mention the bot in a channel or send it a DM to auto-capture.');

    const payload = { channel: this.config.chatId };

    if (options.approvalId) {
      payload.text = text;
      payload.blocks = [
        { type: 'section', text: { type: 'mrkdwn', text: `\ud83d\udea8 *Approval Required*\n${truncate(text, 2800)}` } },
        { type: 'divider' },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: { type: 'plain_text', text: '\u2705 Approve' },
              style: 'primary',
              action_id: 'groove_approve',
              value: options.approvalId,
            },
            {
              type: 'button',
              text: { type: 'plain_text', text: '\u274c Reject' },
              style: 'danger',
              action_id: 'groove_reject',
              value: options.approvalId,
            },
          ],
        },
      ];
    } else {
      payload.text = truncate(text, 3000);
      payload.blocks = [
        { type: 'section', text: { type: 'mrkdwn', text: truncate(text, 3000) } },
      ];
    }

    await this.app.client.chat.postMessage(payload);
  }

  /**
   * List channels the bot is a member of.
   */
  async listChannels() {
    if (!this.app) return [];
    try {
      const result = await this.app.client.conversations.list({
        types: 'public_channel,private_channel',
        exclude_archived: true,
        limit: 200,
      });
      // Return all channels — mark which ones the bot is in
      return (result.channels || []).map((c) => ({
        id: c.id,
        name: c.name,
        isMember: c.is_member,
      }));
    } catch (err) {
      console.log(`[Groove:Slack] listChannels error: ${err.message}`);
      return [];
    }
  }

  _buildReply(response) {
    if (!response) return {};
    const text = response.text || '';
    return {
      text,
      blocks: [
        { type: 'section', text: { type: 'mrkdwn', text: '```' + truncate(text, 2900) + '```' } },
      ],
    };
  }
}
