// GROOVE — Agent Loop Engine (Local Model Runtime)
// FSL-1.1-Apache-2.0 — see LICENSE
//
// Core agentic runtime for local models. Manages a multi-turn conversation
// with tool calling against any OpenAI-compatible API. Plugs into all
// existing GROOVE orchestration (rotation, journalist, token tracking, routing).

import { EventEmitter } from 'events';
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'fs';
import { resolve, dirname } from 'path';
import { TOOL_DEFINITIONS, ToolExecutor } from './tool-executor.js';

export class AgentLoop extends EventEmitter {
  constructor({ daemon, agent, loopConfig, logStream }) {
    super();
    this.daemon = daemon;
    this.agent = agent;
    this.config = loopConfig;
    this.logStream = logStream;

    // Conversation state
    this.messages = [];
    this.running = false;
    this.idle = true;
    this.abortController = null;

    // Tool calling mode: 'native' uses OpenAI function-calling API fields,
    // 'prompt' injects tool schemas into the system prompt and parses
    // <tool_call> blocks from the model's text output.
    this.toolMode = 'native';

    // Metrics
    this.totalTokensIn = 0;
    this.totalTokensOut = 0;
    this.turns = 0;
    this.toolCallCount = 0;
    this.startedAt = Date.now();

    // Tool executor — sandboxed to agent's working directory
    this.executor = new ToolExecutor(
      agent.workingDir || daemon.projectDir,
      daemon,
      agent.id,
      daemon.projectDir,
    );

    // Session persistence
    this.sessionPath = resolve(daemon.grooveDir, 'sessions', `${agent.id}.json`);

    // Load existing session or initialize with system prompt
    const savedMessages = AgentLoop.loadSession(this.sessionPath);
    if (savedMessages && savedMessages.length > 0) {
      this.messages = savedMessages;
    } else {
      this.messages.push({
        role: 'system',
        content: this._buildSystemPrompt(),
      });
    }
  }

  // --- Lifecycle ---

  async start(initialPrompt) {
    this.running = true;
    this.isInitialPrompt = true;
    this._writeLog({ type: 'system', event: 'start', model: this.config.model });

    if (initialPrompt) {
      await this.sendMessage(initialPrompt);
    }
  }

  async sendMessage(content) {
    if (!this.running) return;

    this.idle = false;
    this.messages.push({ role: 'user', content });
    this._writeLog({ type: 'user', content: content.slice(0, 1000) });

    try {
      await this._runLoop();
    } catch (err) {
      this._writeLog({ type: 'error', text: err.message });
      this.emit('error', { message: err.message });
    }

    if (this.running && this.isInitialPrompt && this._shouldAutoComplete()) {
      this.running = false;
      const duration = Date.now() - this.startedAt;
      this.daemon.tokens.recordResult(this.agent.id, { durationMs: duration, turns: this.turns });
      this.emit('exit', { code: 0, signal: null, status: 'completed' });
    }

    if (this.running && this.isInitialPrompt && this.turns <= 1 && this.totalTokensIn === 0 && this.totalTokensOut === 0) {
      this.running = false;
      this.emit('exit', { code: 1, signal: null, status: 'crashed' });
    }

    this.isInitialPrompt = false;
    this._saveSession();
    this.idle = true;
  }

  async stop() {
    this.running = false;
    if (this.abortController) {
      this.abortController.abort();
    }

    const duration = Date.now() - this.startedAt;
    this._writeLog({
      type: 'result',
      result: 'Agent stopped',
      tokensUsed: this.totalTokensIn + this.totalTokensOut,
      duration,
      turns: this.turns,
    });

    // Record final session metrics
    this.daemon.tokens.recordResult(this.agent.id, {
      durationMs: duration,
      turns: this.turns,
    });

    this.emit('exit', { code: 0, signal: 'SIGTERM', status: 'killed' });
  }

  // --- Core Loop ---

  async _runLoop() {
    let consecutiveErrors = 0;

    while (this.running) {
      this.turns++;

      const response = await this._callApi();
      if (!response || !this.running) break;

      let { content, toolCalls, usage, finishReason } = response;
      consecutiveErrors = 0; // Reset on successful call

      // Update token tracking from API response
      if (usage) {
        this._updateTokens(usage);
      }

      // In prompt-based mode, parse tool calls from the model's text
      if (this.toolMode === 'prompt' && content) {
        const parsed = this._parseToolCallsFromText(content);
        if (parsed.length > 0) {
          toolCalls = parsed;
        }
      }

      // Append assistant message to conversation history
      const assistantMsg = { role: 'assistant' };
      if (content) assistantMsg.content = content;
      if (this.toolMode === 'native' && toolCalls?.length > 0) {
        assistantMsg.tool_calls = toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.function.name, arguments: tc.function.arguments },
        }));
      }
      this.messages.push(assistantMsg);

      // No tool calls → turn complete, broadcast final text and go idle
      if (!toolCalls || toolCalls.length === 0) {
        if (content) {
          this._writeLog({ type: 'assistant', content: content.slice(0, 2000) });
        }
        this.emit('output', { type: 'result', subtype: 'assistant', data: content || 'Turn complete', turns: this.turns });
        break;
      }

      // Has tool calls — broadcast text before executing tools (if model sent text + tools)
      const displayContent = this.toolMode === 'prompt'
        ? (content || '').replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '').trim()
        : content;
      if (displayContent) {
        this._writeLog({ type: 'assistant', content: displayContent.slice(0, 2000) });
        this.emit('output', { type: 'activity', subtype: 'assistant', data: displayContent });
      }

      // Execute each tool call
      for (const call of toolCalls) {
        if (!this.running) break;

        let args;
        try {
          args = JSON.parse(call.function.arguments);
        } catch {
          args = {};
        }

        const toolName = call.function.name;
        const inputSummary = this._summarizeToolInput(toolName, args);

        // Log + broadcast tool invocation
        this._writeLog({ type: 'tool_use', tool: toolName, input: inputSummary });
        this.emit('output', { type: 'activity', subtype: 'tool_use', data: [{ type: 'tool_use', name: toolName, input: args }] });

        // Feed classifier for adaptive routing
        this.daemon.classifier.addEvent(this.agent.id, {
          type: 'tool', tool: toolName,
          input: args.path || args.command || args.pattern || '',
        });

        // Execute
        const result = await this.executor.execute(toolName, args);
        this.toolCallCount++;

        // Log + broadcast result
        const resultPreview = (result.result || result.error || '').slice(0, 500);
        this._writeLog({
          type: 'tool_result', tool: toolName,
          success: result.success, output: resultPreview,
        });
        this.emit('output', {
          type: 'activity', subtype: 'tool_result',
          data: [{ type: 'tool_result', name: toolName, success: result.success, output: resultPreview }],
        });

        if (!result.success) {
          this.daemon.classifier.addEvent(this.agent.id, { type: 'error', text: result.error });
        }

        // Append tool result to conversation for the model
        const resultContent = result.success ? (result.result || 'Done.') : `Error: ${result.error}`;
        if (this.toolMode === 'native') {
          this.messages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: resultContent,
          });
        } else {
          this.messages.push({
            role: 'user',
            content: `<tool_result name="${toolName}">\n${resultContent}\n</tool_result>`,
          });
        }
      }

      // Context rotation is handled by the Rotator's 15s polling loop
      // which checks registry.contextUsage against the adaptive threshold.
      // The journalist has full logs — no need for in-loop compaction.
    }
  }

  _shouldAutoComplete() {
    const lastAssistant = [...this.messages].reverse().find(m => m.role === 'assistant');
    if (!lastAssistant) return false;
    return lastAssistant.content && (!lastAssistant.tool_calls || lastAssistant.tool_calls.length === 0) && this.turns >= 1;
  }

  // --- API Communication ---

  async _callApi() {
    const body = {
      model: this.config.model,
      messages: this.messages,
      temperature: this.config.temperature ?? 0.1,
      max_tokens: this.config.maxResponseTokens || 4096,
    };

    if (this.toolMode === 'native') {
      body.tools = TOOL_DEFINITIONS;
      body.tool_choice = 'auto';
    }

    if (this.config.stream !== false) {
      body.stream = true;
      body.stream_options = { include_usage: true };
    }

    const url = `${this.config.apiBase}/chat/completions`;
    const maxRetries = 3;
    let lastError = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      this.abortController = new AbortController();

      let response;
      try {
        response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {}),
            ...this.config.headers,
          },
          body: JSON.stringify(body),
          signal: this.abortController.signal,
        });
      } catch (err) {
        if (err.name === 'AbortError') return null;
        lastError = `Inference API unreachable: ${err.message}`;
        if (attempt < 2) {
          this._writeLog({ type: 'retry', attempt: attempt + 1, reason: lastError, delayMs: 2000 });
          await new Promise(r => setTimeout(r, 2000));
          continue;
        }
        this._writeLog({ type: 'error', text: `API request failed: ${err.message}` });
        this.emit('error', { message: lastError });
        return null;
      }

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        const errMsg = `API error ${response.status}: ${text.slice(0, 500)}`;

        // Detect tool_choice rejection (vLLM, TGI, etc. without tool-calling flags)
        // Fall back to prompt-based tool calling and retry immediately
        if (response.status === 400 && this.toolMode === 'native' &&
            (text.includes('tool_choice') || text.includes('tool-call-parser') || text.includes('enable-auto-tool-choice'))) {
          this._writeLog({ type: 'system', event: 'tool-fallback', reason: 'Runtime rejected native tool calling — switching to prompt-based tools' });
          this.toolMode = 'prompt';
          this._injectToolPrompt();
          delete body.tools;
          delete body.tool_choice;
          continue;
        }

        if (response.status === 401 || response.status === 403) {
          this._writeLog({ type: 'error', text: errMsg });
          this.emit('error', { message: errMsg });
          return null;
        }

        if ((response.status === 429 || response.status === 503) && attempt < maxRetries) {
          const delay = Math.pow(2, attempt + 1) * 1000;
          this._writeLog({ type: 'retry', attempt: attempt + 1, reason: errMsg, delayMs: delay });
          await new Promise(r => setTimeout(r, delay));
          lastError = errMsg;
          continue;
        }

        this._writeLog({ type: 'error', text: errMsg });
        this.emit('error', { message: errMsg });
        return null;
      }

      if (body.stream) {
        return this._parseSSE(response);
      }
      return this._parseJSON(response);
    }

    this._writeLog({ type: 'error', text: `API failed after retries: ${lastError}` });
    this.emit('error', { message: lastError });
    return null;
  }

  async _parseSSE(response) {
    let content = '';
    const toolCalls = new Map(); // index -> { id, function: { name, arguments } }
    let usage = null;
    let finishReason = null;
    let buffer = '';

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data: ')) continue;
          const payload = trimmed.slice(6);
          if (payload === '[DONE]') continue;

          let data;
          try { data = JSON.parse(payload); } catch { continue; }

          if (data.usage) usage = data.usage;

          const choice = data.choices?.[0];
          if (!choice) continue;

          if (choice.finish_reason) finishReason = choice.finish_reason;
          const delta = choice.delta || {};

          // Stream text tokens to GUI in real-time
          if (delta.content) {
            content += delta.content;
            this.emit('output', { type: 'activity', subtype: 'stream', data: delta.content });
          }

          // Accumulate tool call deltas
          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0;
              if (!toolCalls.has(idx)) {
                toolCalls.set(idx, {
                  id: tc.id || `call_${idx}_${Date.now()}`,
                  function: { name: '', arguments: '' },
                });
              }
              const existing = toolCalls.get(idx);
              if (tc.id) existing.id = tc.id;
              if (tc.function?.name) existing.function.name = tc.function.name;
              if (tc.function?.arguments) existing.function.arguments += tc.function.arguments;
            }
          }
        }
      }
    } catch (err) {
      if (err.name === 'AbortError') return null;
      this._writeLog({ type: 'error', text: `Stream parse error: ${err.message}` });
      this.emit('error', { message: `Stream error: ${err.message}` });
      return null;
    }

    return {
      content: content || null,
      toolCalls: toolCalls.size > 0 ? Array.from(toolCalls.values()) : null,
      usage,
      finishReason,
    };
  }

  async _parseJSON(response) {
    const data = await response.json();
    const choice = data.choices?.[0];
    if (!choice) return null;

    const msg = choice.message || {};
    return {
      content: msg.content || null,
      toolCalls: msg.tool_calls?.map((tc) => ({
        id: tc.id,
        function: { name: tc.function.name, arguments: tc.function.arguments },
      })) || null,
      usage: data.usage || null,
      finishReason: choice.finish_reason,
    };
  }

  // --- Prompt-Based Tool Calling Fallback ---

  _injectToolPrompt() {
    const toolPrompt = this._buildToolPrompt();
    const systemIdx = this.messages.findIndex(m => m.role === 'system');
    if (systemIdx >= 0) {
      this.messages[systemIdx].content += '\n\n' + toolPrompt;
    } else {
      this.messages.unshift({ role: 'system', content: toolPrompt });
    }
  }

  _buildToolPrompt() {
    const toolDefs = TOOL_DEFINITIONS.map(t => {
      const f = t.function;
      const params = Object.entries(f.parameters.properties).map(([name, schema]) => {
        const req = f.parameters.required?.includes(name) ? ' (required)' : ' (optional)';
        return `  - ${name}: ${schema.type}${req} — ${schema.description}`;
      }).join('\n');
      return `### ${f.name}\n${f.description}\nParameters:\n${params}`;
    }).join('\n\n');

    return `## Available Tools

To use a tool, include a tool_call block in your response:

<tool_call>
{"name": "tool_name", "arguments": {"param1": "value1"}}
</tool_call>

You can make multiple tool calls in one response. After each tool call you will receive a <tool_result> with the output.

${toolDefs}

Always use tools to read, write, or search files and to run commands. Do not guess file contents.`;
  }

  _parseToolCallsFromText(content) {
    if (!content) return [];
    const calls = [];
    const regex = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g;
    let match;
    while ((match = regex.exec(content)) !== null) {
      try {
        const parsed = JSON.parse(match[1].trim());
        if (parsed.name) {
          calls.push({
            id: `call_${Date.now()}_${calls.length}`,
            function: {
              name: parsed.name,
              arguments: JSON.stringify(parsed.arguments || {}),
            },
          });
        }
      } catch { /* skip malformed tool call */ }
    }
    return calls;
  }

  // --- Token Tracking ---

  _updateTokens(usage) {
    const inputTokens = usage.prompt_tokens || 0;
    const outputTokens = usage.completion_tokens || 0;
    const totalTokens = usage.total_tokens || (inputTokens + outputTokens);

    this.totalTokensIn += inputTokens;
    this.totalTokensOut += outputTokens;

    // Context usage = how full the context window is
    const contextWindow = this.config.contextWindow || 32768;
    const contextUsage = contextWindow > 0 ? Math.min(inputTokens / contextWindow, 1) : 0;

    // Emit token event — ProcessManager handles registry updates + subsystem feeding
    this.emit('output', {
      type: 'activity',
      tokensUsed: totalTokens,
      inputTokens,
      outputTokens,
      model: this.config.model,
      contextUsage,
    });
  }

  // --- System Prompt ---

  _buildSystemPrompt() {
    const parts = [];
    const wd = this.agent.workingDir || this.daemon.projectDir;

    parts.push(`You are a coding agent. Your working directory is: ${wd}`);
    parts.push('');
    parts.push('You have tools for reading, writing, editing, and searching files, and for running shell commands.');
    parts.push('Work methodically: explore the codebase first, understand what exists, then make changes. Test your work when possible.');
    parts.push('');
    parts.push('Guidelines:');
    parts.push('- Read files before editing them');
    parts.push('- Make targeted edits with edit_file rather than rewriting entire files');
    parts.push('- Run tests and builds after changes to verify correctness');
    parts.push('- If a tool call fails, read the error and adjust your approach');

    if (this.agent.scope?.length > 0) {
      parts.push('');
      parts.push(`File scope: You may only modify files matching these patterns: ${this.agent.scope.join(', ')}`);
      parts.push('You can read any file, but writes outside your scope will be blocked.');
    }

    // GROOVE intro context — team awareness, coordination, project map
    if (this.config.introContext) {
      parts.push('');
      parts.push(this.config.introContext);
    }

    return parts.join('\n');
  }

  // --- Logging (journalist-compatible) ---

  _writeLog(entry) {
    if (!this.logStream) return;
    const line = JSON.stringify({ ...entry, ts: Date.now() });
    this.logStream.write(line + '\n');
  }

  _summarizeToolInput(toolName, args) {
    switch (toolName) {
      case 'read_file': {
        let s = args.path || '';
        if (args.offset) s += ` (from line ${args.offset})`;
        if (args.limit) s += ` (${args.limit} lines)`;
        return s;
      }
      case 'write_file': return `${args.path || ''} (${(args.content || '').split('\n').length} lines)`;
      case 'edit_file': return args.path || '';
      case 'run_command': return (args.command || '').slice(0, 120);
      case 'search_files': return args.pattern || '';
      case 'search_content': return `${args.pattern || ''} in ${args.path || '.'}`;
      case 'list_directory': return args.path || '.';
      default: return JSON.stringify(args).slice(0, 100);
    }
  }

  // --- Status ---

  getState() {
    return {
      running: this.running,
      idle: this.idle,
      turns: this.turns,
      toolCallCount: this.toolCallCount,
      totalTokensIn: this.totalTokensIn,
      totalTokensOut: this.totalTokensOut,
      messageCount: this.messages.length,
      model: this.config.model,
      uptime: Date.now() - this.startedAt,
    };
  }

  // --- Session Persistence ---

  _saveSession() {
    try {
      mkdirSync(dirname(this.sessionPath), { recursive: true });
      let toSave = this.messages;
      if (toSave.length > 201) {
        const hasSystem = toSave[0]?.role === 'system';
        toSave = hasSystem
          ? [toSave[0], ...toSave.slice(-200)]
          : toSave.slice(-200);
      }
      writeFileSync(this.sessionPath, JSON.stringify(toSave), { mode: 0o600 });
    } catch { /* non-fatal */ }
  }

  static loadSession(sessionPath) {
    try {
      if (!existsSync(sessionPath)) return null;
      const data = readFileSync(sessionPath, 'utf8');
      const messages = JSON.parse(data);
      if (Array.isArray(messages) && messages.length > 0) return messages;
    } catch { /* corrupted session */ }
    return null;
  }

  clearSession() {
    try {
      if (existsSync(this.sessionPath)) unlinkSync(this.sessionPath);
    } catch { /* non-fatal */ }
  }
}
