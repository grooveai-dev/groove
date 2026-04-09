// GROOVE — Base Gateway Interface
// FSL-1.1-Apache-2.0 — see LICENSE

export class BaseGateway {
  static type = 'base';
  static displayName = 'Base Gateway';
  static description = '';
  static credentialKeys = []; // [{ key, label, required, help }]

  constructor(daemon, config) {
    this.daemon = daemon;
    this.config = config; // { id, type, enabled, chatId, allowedUsers, notifications }
    this.connected = false;
  }

  /**
   * Connect to the messaging platform. Called by GatewayManager.start().
   */
  async connect() {
    throw new Error('Gateway must implement connect()');
  }

  /**
   * Gracefully disconnect. Called by GatewayManager.stop().
   */
  async disconnect() {
    throw new Error('Gateway must implement disconnect()');
  }

  /**
   * Send a message to the configured chat/channel.
   * @param {string} text — formatted message text
   * @param {object} [options] — platform-specific options (replyMarkup, embeds, blocks, etc.)
   */
  async send(text, options) {
    throw new Error('Gateway must implement send()');
  }

  /**
   * Process an inbound command from chat. Checks authorization, then delegates
   * to GatewayManager.routeCommand() for actual execution.
   * @param {string} command — command name (without leading /)
   * @param {string[]} args — command arguments
   * @param {string} userId — platform-specific user ID
   * @returns {{ text: string, options?: object } | null}
   */
  async handleCommand(command, args, userId) {
    if (!this._isAuthorized(userId)) {
      return { text: 'Unauthorized. Your user ID is not in the gateway allowlist.' };
    }
    return this.daemon.gateways.routeCommand(this, command, args, userId);
  }

  /**
   * Check if a user is authorized to send commands.
   * Empty allowlist = open access (for personal bots).
   */
  _isAuthorized(userId) {
    const allow = this.config.allowedUsers || [];
    if (allow.length === 0) return true;
    return allow.includes(String(userId));
  }

  /**
   * Get the credential value for this gateway from CredentialStore.
   */
  _getCredential(key) {
    return this.daemon.credentials.getKey(`gateway:${this.config.id}:${key}`);
  }

  /**
   * Return current gateway status for API responses.
   */
  getStatus() {
    // Check if required credentials are set
    const hasCredentials = this.constructor.credentialKeys
      .filter((ck) => ck.required)
      .every((ck) => !!this._getCredential(ck.key));

    return {
      id: this.config.id,
      type: this.constructor.type,
      displayName: this.constructor.displayName,
      connected: this.connected,
      enabled: this.config.enabled,
      hasCredentials,
      chatId: this.config.chatId || null,
      notifications: this.config.notifications || { preset: 'critical' },
      commandPermission: this.config.commandPermission || 'full',
      allowedUsers: (this.config.allowedUsers || []).length,
    };
  }
}
