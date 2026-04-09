// GROOVE — Slack Gateway (@slack/bolt Socket Mode)
// FSL-1.1-Apache-2.0 — see LICENSE

import { BaseGateway } from './base.js';
import { truncate, statusEmoji, formatTokens } from './formatter.js';

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
    });

    // Handle messages starting with /
    this.app.message(/^\/\w+/, async ({ message, say }) => {
      const userId = message.user;
      const [command, ...args] = message.text.slice(1).split(/\s+/);

      // Auto-capture channelId
      if (!this.config.chatId) {
        this.config.chatId = message.channel;
        this.daemon.gateways._save(this.config.id);
      }

      const response = await this.handleCommand(command, args, userId);
      if (response) {
        await say(this._buildReply(response));
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

    await this.app.start();

    this.connected = true;
    console.log('[Groove:Slack] Connected via Socket Mode');
  }

  async disconnect() {
    if (this.app) {
      await this.app.stop();
      this.app = null;
    }
    this.connected = false;
    console.log('[Groove:Slack] Disconnected');
  }

  async send(text, options = {}) {
    if (!this.app || !this.config.chatId) return;

    const payload = { channel: this.config.chatId };

    if (options.approvalId) {
      // Block Kit message with approve/reject buttons
      payload.text = text; // Fallback for notifications
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
      // Standard Block Kit message
      payload.text = truncate(text, 3000); // Fallback
      payload.blocks = [
        { type: 'section', text: { type: 'mrkdwn', text: truncate(text, 3000) } },
      ];
    }

    await this.app.client.chat.postMessage(payload);
  }

  /**
   * Build a reply payload from a command response.
   */
  _buildReply(response) {
    if (!response) return {};
    const text = response.text || '';
    // Wrap in a code block for command output readability
    return {
      text,
      blocks: [
        { type: 'section', text: { type: 'mrkdwn', text: '```' + truncate(text, 2900) + '```' } },
      ],
    };
  }
}
