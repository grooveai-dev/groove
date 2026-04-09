// GROOVE — Telegram Gateway (Zero-dependency Bot API)
// FSL-1.1-Apache-2.0 — see LICENSE

import { BaseGateway } from './base.js';

const POLL_TIMEOUT = 30; // seconds — Telegram long-poll
const BACKOFF_BASE = 3000; // ms
const BACKOFF_MAX = 30000; // ms

export class TelegramGateway extends BaseGateway {
  static type = 'telegram';
  static displayName = 'Telegram';
  static description = 'Telegram bot for notifications and agent commands';
  static credentialKeys = [
    { key: 'bot_token', label: 'Bot Token', required: true, help: 'Create a bot via @BotFather on Telegram' },
  ];

  constructor(daemon, config) {
    super(daemon, config);
    this.token = null;
    this.botInfo = null;
    this._pollOffset = 0;
    this._polling = false;
    this._abort = null;
    this._backoff = BACKOFF_BASE;
  }

  async connect() {
    this.token = this._getCredential('bot_token');
    if (!this.token) throw new Error('Telegram bot token not configured');

    // Validate token with getMe
    this.botInfo = await this._api('getMe');
    this.connected = true;
    this._backoff = BACKOFF_BASE;

    console.log(`[Groove:Telegram] Connected as @${this.botInfo.username}`);

    // Start polling loop (non-blocking)
    this._startPolling();
  }

  async disconnect() {
    this._polling = false;
    if (this._abort) {
      this._abort.abort();
      this._abort = null;
    }
    this.connected = false;
    console.log('[Groove:Telegram] Disconnected');
  }

  async send(text, options = {}) {
    const chatId = this.config.chatId;
    if (!chatId) throw new Error('No chat configured. Send a message to the bot first, or set a Chat ID in Settings.');

    const params = {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    };

    // Add inline keyboard for approval actions
    if (options.approvalId) {
      params.reply_markup = {
        inline_keyboard: [[
          { text: '\u2705 Approve', callback_data: `approve:${options.approvalId}` },
          { text: '\u274c Reject', callback_data: `reject:${options.approvalId}` },
        ]],
      };
    }

    await this._api('sendMessage', params);
  }

  getStatus() {
    return {
      ...super.getStatus(),
      botUsername: this.botInfo?.username || null,
    };
  }

  // -------------------------------------------------------------------
  // Long-Polling Loop
  // -------------------------------------------------------------------

  async _startPolling() {
    this._polling = true;

    while (this._polling) {
      try {
        this._abort = new AbortController();
        const updates = await this._api('getUpdates', {
          offset: this._pollOffset,
          timeout: POLL_TIMEOUT,
          allowed_updates: ['message', 'callback_query'],
        }, this._abort.signal);

        // Reset backoff on success
        this._backoff = BACKOFF_BASE;

        for (const update of updates) {
          this._pollOffset = update.update_id + 1;
          this._handleUpdate(update).catch((err) => {
            console.log(`[Groove:Telegram] Error handling update: ${err.message}`);
          });
        }
      } catch (err) {
        if (err.name === 'AbortError') break;
        console.log(`[Groove:Telegram] Poll error: ${err.message}`);
        // Exponential backoff
        await new Promise((r) => setTimeout(r, this._backoff));
        this._backoff = Math.min(this._backoff * 1.5, BACKOFF_MAX);
      }
    }
  }

  // -------------------------------------------------------------------
  // Update Handlers
  // -------------------------------------------------------------------

  async _handleUpdate(update) {
    if (update.callback_query) {
      return this._handleCallbackQuery(update.callback_query);
    }

    const msg = update.message;
    if (!msg?.text) return;

    // Auto-capture chatId from first message
    if (!this.config.chatId) {
      this.config.chatId = String(msg.chat.id);
      // Persist the captured chatId
      this.daemon.gateways._save(this.config.id);
      console.log(`[Groove:Telegram] Auto-captured chatId: ${this.config.chatId}`);
    }

    // Only process commands (starts with /)
    if (!msg.text.startsWith('/')) return;

    const userId = String(msg.from.id);
    const text = msg.text.split('@')[0]; // Remove @botname suffix from group commands
    const [rawCmd, ...args] = text.slice(1).split(/\s+/);
    const command = rawCmd.toLowerCase();

    const response = await this.handleCommand(command, args, userId);
    if (response) {
      await this._reply(msg.chat.id, response.text, response.options);
    }
  }

  async _handleCallbackQuery(query) {
    const userId = String(query.from.id);

    // Authorization check
    if (!this._isAuthorized(userId)) {
      await this._answerCallback(query.id, 'Unauthorized');
      return;
    }

    const data = query.data || '';
    const [action, ...rest] = data.split(':');
    const approvalId = rest.join(':');

    if (!approvalId) {
      await this._answerCallback(query.id, 'Invalid action');
      return;
    }

    let responseText;
    try {
      if (action === 'approve') {
        this.daemon.supervisor.approve(approvalId);
        responseText = `\u2705 Approved: ${approvalId}`;
      } else if (action === 'reject') {
        this.daemon.supervisor.reject(approvalId);
        responseText = `\u274c Rejected: ${approvalId}`;
      } else {
        await this._answerCallback(query.id, 'Unknown action');
        return;
      }
    } catch (err) {
      await this._answerCallback(query.id, `Error: ${err.message}`);
      return;
    }

    // Acknowledge the callback
    await this._answerCallback(query.id, responseText);

    // Update the original message to reflect the action
    if (query.message) {
      try {
        await this._api('editMessageReplyMarkup', {
          chat_id: query.message.chat.id,
          message_id: query.message.message_id,
          reply_markup: { inline_keyboard: [] }, // Remove buttons
        });
        await this._api('editMessageText', {
          chat_id: query.message.chat.id,
          message_id: query.message.message_id,
          text: `${query.message.text}\n\n${responseText}`,
          parse_mode: 'HTML',
        });
      } catch { /* best effort — message may be too old to edit */ }
    }
  }

  // -------------------------------------------------------------------
  // Telegram Bot API Helpers
  // -------------------------------------------------------------------

  async _reply(chatId, text, options = {}) {
    const params = {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    };
    if (options.approvalId) {
      params.reply_markup = {
        inline_keyboard: [[
          { text: '\u2705 Approve', callback_data: `approve:${options.approvalId}` },
          { text: '\u274c Reject', callback_data: `reject:${options.approvalId}` },
        ]],
      };
    }
    await this._api('sendMessage', params);
  }

  async _answerCallback(callbackQueryId, text) {
    await this._api('answerCallbackQuery', {
      callback_query_id: callbackQueryId,
      text,
    });
  }

  /**
   * Call the Telegram Bot API.
   * @param {string} method — API method name
   * @param {object} [body] — request body (JSON)
   * @param {AbortSignal} [signal] — abort signal
   * @returns {any} — result from Telegram API
   */
  async _api(method, body, signal) {
    const url = `https://api.telegram.org/bot${this.token}/${method}`;
    const options = {
      method: body ? 'POST' : 'GET',
      signal,
    };

    if (body) {
      options.headers = { 'Content-Type': 'application/json' };
      options.body = JSON.stringify(body);
    }

    const res = await fetch(url, options);
    const data = await res.json();

    if (!data.ok) {
      throw new Error(data.description || `Telegram API error: ${method}`);
    }

    return data.result;
  }
}
