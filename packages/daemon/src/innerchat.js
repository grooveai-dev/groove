// FSL-1.1-Apache-2.0 — see LICENSE

import { randomUUID } from 'crypto';

export class InnerChat {
  constructor(daemon) {
    this.daemon = daemon;
    this.messages = new Map();
    this.pendingResponses = new Map();
  }

  async send(fromAgentId, toAgentId, message) {
    const fromAgent = this.daemon.registry.get(fromAgentId);
    const toAgent = this.daemon.registry.get(toAgentId);
    if (!fromAgent) throw new Error(`Sender agent ${fromAgentId} not found`);
    if (!toAgent) throw new Error(`Target agent ${toAgentId} not found`);

    const id = randomUUID().slice(0, 12);
    const msg = {
      id,
      from: { id: fromAgent.id, name: fromAgent.name, role: fromAgent.role },
      to: { id: toAgent.id, name: toAgent.name, role: toAgent.role },
      message,
      response: null,
      status: 'sent',
      timestamp: Date.now(),
      respondedAt: null,
    };

    this.messages.set(id, msg);
    this.pendingResponses.set(toAgentId, id);

    const wrapped = `[InnerChat from ${fromAgent.name} (${fromAgent.role})]\n\n${message}\n\nReply normally — your response will be relayed back to ${fromAgent.name}.`;

    let deliveryStatus = 'sent';
    if (this.daemon.processes.hasAgentLoop(toAgentId)) {
      const sent = await this.daemon.processes.sendMessage(toAgentId, wrapped, 'agent');
      deliveryStatus = sent ? 'delivered' : 'queued';
    } else if (this.daemon.processes.isRunning(toAgentId)) {
      this.daemon.processes.queueMessage(toAgentId, wrapped);
      deliveryStatus = 'queued';
    } else {
      throw new Error(`Target agent ${toAgent.name} is not running`);
    }

    msg.status = deliveryStatus;
    this.daemon.broadcast({ type: 'innerchat:sent', data: msg });
    this.daemon.audit.log('innerchat.send', { id, from: fromAgentId, to: toAgentId });

    return msg;
  }

  onAgentOutput(agentId, output) {
    const messageId = this.pendingResponses.get(agentId);
    if (!messageId) return;
    if (output.type !== 'result') return;

    const msg = this.messages.get(messageId);
    if (!msg) return;

    let responseText = '';
    if (typeof output.data === 'string') {
      responseText = output.data;
    } else if (Array.isArray(output.data)) {
      responseText = output.data.filter(b => b.type === 'text').map(b => b.text).join('\n');
    }
    if (!responseText.trim()) return;

    msg.response = responseText.trim();
    msg.status = 'responded';
    msg.respondedAt = Date.now();
    this.pendingResponses.delete(agentId);

    const relay = `[InnerChat reply from ${msg.to.name} (${msg.to.role})]\n\n${msg.response}`;
    const senderId = msg.from.id;
    if (this.daemon.processes.hasAgentLoop(senderId)) {
      this.daemon.processes.sendMessage(senderId, relay, 'agent').catch(() => {});
    } else if (this.daemon.processes.isRunning(senderId)) {
      this.daemon.processes.queueMessage(senderId, relay);
    }

    this.daemon.broadcast({ type: 'innerchat:response', data: msg });
    this.daemon.audit.log('innerchat.response', { id: messageId, from: msg.from.id, to: msg.to.id });
  }

  getMessages(agentId = null) {
    const all = Array.from(this.messages.values());
    if (!agentId) return all;
    return all.filter(m => m.from.id === agentId || m.to.id === agentId);
  }

  getMessage(id) {
    return this.messages.get(id) || null;
  }

  getPending(agentId) {
    const messageId = this.pendingResponses.get(agentId);
    return messageId ? this.messages.get(messageId) : null;
  }
}
