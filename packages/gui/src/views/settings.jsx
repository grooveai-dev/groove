// FSL-1.1-Apache-2.0 — see LICENSE
import { useState, useEffect } from 'react';
import { useGrooveStore } from '../stores/groove';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { ScrollArea } from '../components/ui/scroll-area';
import { Skeleton } from '../components/ui/skeleton';
import { StatusDot } from '../components/ui/status-dot';
import { OllamaSetup } from '../components/agents/ollama-setup';
import { FolderBrowser } from '../components/agents/folder-browser';
import { Sheet, SheetContent } from '../components/ui/sheet';
import { api } from '../lib/api';
import { cn } from '../lib/cn';
import { fmtUptime } from '../lib/format';
import {
  Key, Eye, EyeOff, Check, Cpu, ChevronDown,
  FolderOpen, FolderSearch, RotateCw, Users, Gauge, Zap,
  LogIn, LogOut, User, ShieldCheck, Settings,
  Newspaper, Layers, Radio, Send, MessageSquare, MessageCircle,
  Plus, Trash2, Plug, PlugZap, TestTube, X, HelpCircle, ExternalLink, ChevronRight,
} from 'lucide-react';

/* ── Toggle ────────────────────────────────────────────────── */

function Toggle({ value, onChange }) {
  return (
    <button
      onClick={() => onChange(!value)}
      className={cn(
        'w-9 h-5 rounded-full p-0.5 transition-colors cursor-pointer',
        value ? 'bg-accent' : 'bg-surface-5',
      )}
    >
      <div className={cn(
        'w-4 h-4 rounded-full bg-white shadow-sm transition-transform',
        value ? 'translate-x-4' : 'translate-x-0',
      )} />
    </button>
  );
}

/* ── Profile Pic ──────────────────────────────────────────── */

function ProfilePic({ user }) {
  const [broken, setBroken] = useState(false);
  const src = user?.avatar || user?.picture || user?.photoURL || user?.photo;

  if (src && !broken) {
    return (
      <img
        src={src}
        alt=""
        className="w-6 h-6 rounded-full"
        referrerPolicy="no-referrer"
        crossOrigin="anonymous"
        onError={() => setBroken(true)}
      />
    );
  }

  return (
    <div className="w-6 h-6 rounded-full bg-accent/10 flex items-center justify-center">
      <User size={12} className="text-accent" />
    </div>
  );
}

/* ── Provider Card ─────────────────────────────────────────── */

function ProviderCard({ provider, onKeyChange }) {
  const [settingKey, setSettingKey] = useState(false);
  const [keyInput, setKeyInput] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [ollamaOpen, setOllamaOpen] = useState(false);
  const addToast = useGrooveStore((s) => s.addToast);

  const isLocal = provider.authType === 'local';
  const isSubscription = provider.authType === 'subscription';
  // "Ready" means: local + installed, subscription + installed, api-key + hasKey
  const isReady = isLocal ? provider.installed : isSubscription ? provider.installed : provider.hasKey;

  async function handleSetKey() {
    if (!keyInput.trim()) return;
    try {
      await api.post(`/credentials/${provider.id}`, { key: keyInput.trim() });
      addToast('success', `API key set for ${provider.name}`);
      setKeyInput('');
      setSettingKey(false);
      if (onKeyChange) onKeyChange();
    } catch (err) {
      addToast('error', 'Failed to set key', err.message);
    }
  }

  async function handleDeleteKey() {
    try {
      await api.delete(`/credentials/${provider.id}`);
      addToast('info', `Removed ${provider.name} key`);
      if (onKeyChange) onKeyChange();
    } catch (err) {
      addToast('error', 'Remove failed', err.message);
    }
  }

  // Ollama card
  if (isLocal) {
    return (
      <div className="flex flex-col rounded-lg border border-border-subtle bg-surface-1 overflow-hidden min-w-[220px]">
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-border-subtle">
          <StatusDot status={isReady ? 'running' : 'crashed'} size="sm" />
          <span className="text-[13px] font-semibold text-text-0 font-sans">{provider.name}</span>
          <div className="flex-1" />
          {isReady ? (
            <Badge variant="success" className="text-2xs gap-1"><Check size={8} /> Ready</Badge>
          ) : (
            <Badge variant="default" className="text-2xs">Not installed</Badge>
          )}
        </div>
        <div className="flex-1">
          {ollamaOpen ? (
            <OllamaSetup isInstalled={isReady} onModelChange={onKeyChange} />
          ) : (
            <div className="px-4 py-3 flex flex-col h-full">
              <div className="text-xs text-text-3 font-sans flex-1">
                {isReady ? `${provider.models?.length || 0} models available` : 'Local AI models — free, private, no API key'}
              </div>
              <Button
                variant={isReady ? 'secondary' : 'primary'}
                size="sm"
                onClick={() => setOllamaOpen(true)}
                className="w-full h-7 text-2xs gap-1.5 mt-3"
              >
                <Cpu size={11} />
                {isReady ? 'Manage Models' : 'Set Up Ollama'}
              </Button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Standard provider card (Claude, Codex, Gemini)
  return (
    <div className="flex flex-col rounded-lg border border-border-subtle bg-surface-1 overflow-hidden min-w-[220px]">
      {/* Header */}
      <div className="flex items-center gap-2.5 px-4 py-3 border-b border-border-subtle">
        <StatusDot status={isReady ? 'running' : 'crashed'} size="sm" />
        <span className="text-[13px] font-semibold text-text-0 font-sans">{provider.name}</span>
        <div className="flex-1" />
        {isReady ? (
          <Badge variant="success" className="text-2xs gap-1"><Check size={8} /> Ready</Badge>
        ) : (
          <Badge variant="default" className="text-2xs">{isSubscription ? 'Not installed' : 'No key'}</Badge>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 flex flex-col px-4 py-3 min-h-[120px]">
        {/* Models */}
        {provider.models?.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-3">
            {provider.models.map((m) => (
              <span key={m.id} className="px-1.5 py-0.5 rounded bg-surface-4 text-2xs font-mono text-text-3">
                {m.name || m.id}
              </span>
            ))}
          </div>
        )}

        {/* Subscription info for Claude */}
        {isSubscription && isReady && !provider.hasKey && !settingKey && (
          <div className="flex items-center gap-1.5 h-8 px-2.5 bg-accent/8 border border-accent/20 rounded-md text-2xs font-sans text-accent mb-3">
            <Check size={10} /> Subscription active
          </div>
        )}

        {/* Connected state */}
        {provider.hasKey && !settingKey && (
          <div className="flex items-center gap-2 mb-3">
            <div className="flex-1 flex items-center gap-1.5 h-8 px-2.5 bg-success/8 border border-success/20 rounded-md text-2xs font-sans text-success">
              <Check size={10} /> API Connected
            </div>
            <button onClick={() => { setSettingKey(true); setShowKey(false); setKeyInput(''); }} className="text-2xs text-text-4 hover:text-accent cursor-pointer font-sans">Edit</button>
            <button onClick={handleDeleteKey} className="text-2xs text-text-4 hover:text-danger cursor-pointer font-sans">Remove</button>
          </div>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Key input form — takes over the bottom area */}
        {settingKey && (
          <div className="space-y-2.5 pt-1">
            <div>
              <label className="text-2xs font-semibold text-text-2 font-sans mb-1.5 block">
                {provider.hasKey ? 'Update API Key' : `${provider.name} API Key`}
              </label>
              <div className="relative">
                <input
                  value={keyInput}
                  onChange={(e) => setKeyInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSetKey()}
                  type={showKey ? 'text' : 'password'}
                  placeholder="sk-..."
                  className="w-full h-9 px-3 pr-9 text-xs bg-surface-0 border border-border rounded-md text-text-0 font-mono placeholder:text-text-4 focus:outline-none focus:ring-1 focus:ring-accent"
                  autoFocus
                />
                <button onClick={() => setShowKey(!showKey)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-4 hover:text-text-2 cursor-pointer">
                  {showKey ? <EyeOff size={12} /> : <Eye size={12} />}
                </button>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="primary" size="sm" onClick={handleSetKey} disabled={!keyInput.trim()} className="flex-1 h-8 text-xs">
                Save Key
              </Button>
              <Button variant="ghost" size="sm" onClick={() => { setSettingKey(false); setKeyInput(''); }} className="h-8 text-xs px-3">
                Cancel
              </Button>
            </div>
          </div>
        )}

        {/* Bottom action — always at card bottom */}
        {!settingKey && !provider.hasKey && (
          <Button
            variant={isSubscription ? 'secondary' : 'primary'}
            size="sm"
            onClick={() => { setSettingKey(true); setShowKey(false); setKeyInput(''); }}
            className="w-full h-8 text-2xs gap-1.5 mt-2"
          >
            <Key size={11} />
            {isSubscription ? 'Add API key for headless mode' : 'Add API Key'}
          </Button>
        )}
      </div>
    </div>
  );
}

/* ── Config Card ───────────────────────────────────────────── */

function ConfigCard({ icon: Icon, label, description, children }) {
  return (
    <div className="rounded-lg border border-border-subtle bg-surface-1 px-4 py-3.5 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <div className="w-6 h-6 rounded bg-accent/8 flex items-center justify-center flex-shrink-0">
          <Icon size={12} className="text-accent" />
        </div>
        <div className="text-[13px] font-medium text-text-0 font-sans leading-tight">{label}</div>
      </div>
      <div className="text-2xs text-text-4 font-sans leading-relaxed">{description}</div>
      <div className="mt-auto pt-1">{children}</div>
    </div>
  );
}

/* ── Gateway Icons ─────────────────────────────────────────── */

const GATEWAY_ICONS = { telegram: Send, discord: MessageSquare, slack: MessageCircle };
const GATEWAY_LABELS = { telegram: 'Telegram', discord: 'Discord', slack: 'Slack' };
const GATEWAY_PLACEHOLDERS = { telegram: 'Bot token from @BotFather', discord: 'Bot token from Developer Portal', slack: 'Bot token (xoxb-...)' };
const NOTIFICATION_PRESETS = ['critical', 'lifecycle', 'all'];

/* ── Gateway Setup Guide (Sheet Panel) ────────────────────── */

function GatewaySetupGuide({ type, open, onOpenChange }) {
  if (!type) return null;

  const guides = {
    telegram: {
      title: 'Set Up Telegram',
      icon: Send,
      intro: 'Create a Telegram bot and connect it to Groove in under 2 minutes. No dependencies required.',
      sections: [
        {
          title: 'Create Your Bot',
          steps: [
            { text: 'Open Telegram on any device and search for', link: 'https://t.me/BotFather', linkText: '@BotFather' },
            { text: 'Send /newbot to start the setup' },
            { text: 'Choose a display name — we suggest GroovePilot' },
            { text: 'Choose a username (must end in "bot") — e.g. GroovePilot_bot' },
            { text: 'BotFather will reply with your bot token — copy it' },
          ],
        },
        {
          title: 'Connect to Groove',
          steps: [
            { text: 'In Groove Settings > Gateways, click the Slack card\'s Set Token button' },
            { text: 'Paste your bot token and click Save' },
            { text: 'The gateway will connect automatically' },
          ],
        },
        {
          title: 'Link a Chat',
          steps: [
            { text: 'Open a chat with your new bot in Telegram' },
            { text: 'Send any message (e.g. "hello") — Groove captures the chat ID automatically' },
            { text: 'Click Test in the gateway card to verify' },
          ],
        },
        {
          title: 'Commands',
          note: 'All commands use / prefix in Telegram:',
          commands: ['/status', '/agents', '/spawn backend', '/kill <id>', '/approve <id>', '/help'],
        },
      ],
    },
    discord: {
      title: 'Set Up Discord',
      icon: MessageSquare,
      intro: 'Create a Discord bot and add it to your server. Requires discord.js (installed automatically with Groove).',
      sections: [
        {
          title: 'Create the Application',
          steps: [
            { text: 'Go to the', link: 'https://discord.com/developers/applications', linkText: 'Discord Developer Portal' },
            { text: 'Click New Application and name it GroovePilot' },
            { text: 'Go to the Bot tab in the left sidebar' },
            { text: 'Click Reset Token and copy the bot token' },
          ],
        },
        {
          title: 'Set Permissions & Invite',
          steps: [
            { text: 'Go to OAuth2 > URL Generator' },
            { text: 'Under Scopes, check bot' },
            { text: 'Under Bot Permissions, check:' },
          ],
          scopes: ['Send Messages', 'Read Message History', 'Embed Links', 'Use External Emojis'],
          after: [
            { text: 'Copy the generated URL at the bottom and open it in your browser' },
            { text: 'Select your server and click Authorize' },
          ],
        },
        {
          title: 'Enable Message Content Intent',
          steps: [
            { text: 'Go back to the Bot tab in the Developer Portal' },
            { text: 'Scroll to Privileged Gateway Intents' },
            { text: 'Enable Message Content Intent — required for the bot to read commands' },
            { text: 'Click Save Changes' },
          ],
        },
        {
          title: 'Connect to Groove',
          steps: [
            { text: 'In Groove Settings > Gateways, click Set Token on the Discord card' },
            { text: 'Paste your bot token and click Save' },
            { text: 'Send a message in any channel where the bot is — Groove captures the channel automatically' },
          ],
        },
        {
          title: 'Commands',
          note: 'All commands use / prefix in Discord:',
          commands: ['/status', '/agents', '/spawn backend', '/kill <id>', '/approve <id>', '/help'],
        },
      ],
    },
    slack: {
      title: 'Set Up Slack',
      icon: MessageCircle,
      intro: 'Create a Slack app with Socket Mode — no public URL needed. Requires @slack/bolt (installed automatically with Groove).',
      sections: [
        {
          title: 'Create the App',
          steps: [
            { text: 'Go to', link: 'https://api.slack.com/apps', linkText: 'api.slack.com/apps' },
            { text: 'Click Create New App > From scratch' },
            { text: 'Name it GroovePilot and select your workspace' },
          ],
        },
        {
          title: 'Enable Socket Mode',
          steps: [
            { text: 'In the left sidebar, go to Settings > Socket Mode' },
            { text: 'Toggle Enable Socket Mode to on' },
            { text: 'It will ask you to create an App-Level Token' },
            { text: 'Name it "groove", add the connections:write scope' },
            { text: 'Click Generate — copy the xapp-... token (this is your App Token)' },
          ],
          important: 'Save this token now — you can\'t view it again after closing the dialog.',
        },
        {
          title: 'Set Bot Token Scopes',
          steps: [
            { text: 'Go to Features > OAuth & Permissions' },
            { text: 'Scroll to Bot Token Scopes and add all of these:' },
          ],
          scopes: ['chat:write', 'channels:read', 'channels:history', 'groups:read', 'groups:history', 'im:history', 'app_mentions:read'],
          after: [
            { text: 'Scroll up and click Install to Workspace' },
            { text: 'Click Allow to grant permissions' },
            { text: 'Copy the Bot User OAuth Token (xoxb-...) — this is your Bot Token' },
          ],
        },
        {
          title: 'Enable Events',
          steps: [
            { text: 'Go to Features > Event Subscriptions' },
            { text: 'Toggle Enable Events to on' },
            { text: 'Under Subscribe to bot events, add:' },
          ],
          scopes: ['message.channels', 'message.im', 'app_mention'],
          after: [
            { text: 'Click Save Changes at the bottom' },
          ],
        },
        {
          title: 'Connect to Groove',
          steps: [
            { text: 'In Groove Settings > Gateways, click Set Token on the Slack card' },
            { text: 'Paste your Bot Token (xoxb-...) in the first field' },
            { text: 'Paste your App Token (xapp-...) in the second field' },
            { text: 'Click Save — Groove will auto-connect' },
          ],
        },
        {
          title: 'Link a Channel',
          steps: [
            { text: 'Invite the bot to a channel: /invite @GroovePilot' },
            { text: 'Select the channel from the dropdown in the gateway card' },
            { text: 'Or @mention the bot — it will auto-capture the channel' },
            { text: 'Click Test to verify' },
          ],
          important: 'For private channels, make sure you added the groups:read scope.',
        },
        {
          title: 'Commands',
          note: 'In Slack, use plain text commands (no / prefix) or @mention the bot:',
          commands: ['status', 'agents', 'spawn backend', 'kill <id>', 'approve <id>', 'help', '@GroovePilot status'],
        },
      ],
    },
  };

  const guide = guides[type];
  if (!guide) return null;
  const Icon = guide.icon;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent title={guide.title} width={480}>
        <div className="px-5 py-4 space-y-5">
          {/* Intro */}
          <div className="flex items-start gap-3 p-3 bg-accent/5 border border-accent/15 rounded-lg">
            <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center flex-shrink-0 mt-0.5">
              <Icon size={16} className="text-accent" />
            </div>
            <p className="text-xs text-text-2 font-sans leading-relaxed">{guide.intro}</p>
          </div>

          {/* Sections */}
          {guide.sections.map((section, si) => (
            <div key={si}>
              <h3 className="text-xs font-semibold text-text-0 font-sans mb-2.5 flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-accent/10 flex items-center justify-center text-2xs font-bold text-accent">{si + 1}</span>
                {section.title}
              </h3>

              {section.note && (
                <p className="text-2xs text-text-3 font-sans mb-2">{section.note}</p>
              )}

              {section.steps && (
                <ol className="space-y-2 mb-2">
                  {section.steps.map((step, i) => (
                    <li key={i} className="flex gap-2 text-2xs text-text-2 font-sans leading-relaxed">
                      <span className="text-text-4 font-mono w-4 flex-shrink-0 pt-px">{i + 1}.</span>
                      <span>
                        {step.text}
                        {step.link && (
                          <>
                            {' '}
                            <a href={step.link} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline inline-flex items-center gap-0.5 font-medium">
                              {step.linkText}<ExternalLink size={9} />
                            </a>
                          </>
                        )}
                      </span>
                    </li>
                  ))}
                </ol>
              )}

              {section.scopes && (
                <div className="flex flex-wrap gap-1.5 mb-2 ml-6">
                  {section.scopes.map((s) => (
                    <code key={s} className="px-2 py-0.5 rounded bg-surface-4 text-2xs font-mono text-accent">{s}</code>
                  ))}
                </div>
              )}

              {section.after && (
                <ol className="space-y-2 mb-2" start={(section.steps?.length || 0) + 1}>
                  {section.after.map((step, i) => (
                    <li key={i} className="flex gap-2 text-2xs text-text-2 font-sans leading-relaxed">
                      <span className="text-text-4 font-mono w-4 flex-shrink-0 pt-px">{(section.steps?.length || 0) + i + 1}.</span>
                      <span>{step.text}</span>
                    </li>
                  ))}
                </ol>
              )}

              {section.important && (
                <div className="ml-6 p-2 bg-warning/8 border border-warning/20 rounded-md text-2xs text-warning font-sans">
                  {section.important}
                </div>
              )}

              {section.commands && (
                <div className="ml-6 p-2.5 bg-surface-0 border border-border-subtle rounded-md space-y-1">
                  {section.commands.map((cmd) => (
                    <code key={cmd} className="block text-2xs font-mono text-text-1">{cmd}</code>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/* ── Gateway Card ─────────────────────────────────────────── */

function GatewayCard({ gateway, onRefresh }) {
  const [settingToken, setSettingToken] = useState(false);
  const [tokenInput, setTokenInput] = useState('');
  const [appTokenInput, setAppTokenInput] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [testing, setTesting] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [channels, setChannels] = useState([]);
  const [showGuide, setShowGuide] = useState(false);
  const addToast = useGrooveStore((s) => s.addToast);

  // Fetch channels when connected Slack gateway has no chatId
  useEffect(() => {
    if (gateway.connected && !gateway.chatId && gateway.type === 'slack') {
      api.get(`/gateways/${gateway.id}/channels`).then((ch) => setChannels(Array.isArray(ch) ? ch : [])).catch(() => {});
    }
  }, [gateway.connected, gateway.chatId, gateway.id, gateway.type]);

  const Icon = GATEWAY_ICONS[gateway.type] || Radio;
  const isSlack = gateway.type === 'slack';

  async function handleSaveToken() {
    if (!tokenInput.trim()) return;
    try {
      await api.post(`/gateways/${gateway.id}/credentials`, { key: 'bot_token', value: tokenInput.trim() });
      if (isSlack && appTokenInput.trim()) {
        await api.post(`/gateways/${gateway.id}/credentials`, { key: 'app_token', value: appTokenInput.trim() });
      }
      addToast('success', `Token saved — connecting...`);
      setTokenInput('');
      setAppTokenInput('');
      setSettingToken(false);
      // Auto-connect after saving tokens
      try {
        await api.post(`/gateways/${gateway.id}/connect`);
        addToast('success', `${GATEWAY_LABELS[gateway.type]} connected!`);
      } catch (connErr) {
        addToast('error', 'Token saved but connect failed', connErr.message);
      }
      onRefresh();
    } catch (err) {
      addToast('error', 'Failed to save token', err.message);
    }
  }

  async function handleTest() {
    setTesting(true);
    try {
      await api.post(`/gateways/${gateway.id}/test`);
      addToast('success', 'Test message sent!');
    } catch (err) {
      addToast('error', 'Test failed', err.message);
    }
    setTesting(false);
  }

  async function handleToggleConnect() {
    setConnecting(true);
    try {
      if (gateway.connected) {
        await api.post(`/gateways/${gateway.id}/disconnect`);
        addToast('info', `${GATEWAY_LABELS[gateway.type]} disconnected`);
      } else {
        await api.post(`/gateways/${gateway.id}/connect`);
        addToast('success', `${GATEWAY_LABELS[gateway.type]} connected!`);
      }
      onRefresh();
    } catch (err) {
      addToast('error', gateway.connected ? 'Disconnect failed' : 'Connect failed', err.message);
    }
    setConnecting(false);
  }

  async function handleToggleEnabled(enabled) {
    try {
      await api.patch(`/gateways/${gateway.id}`, { enabled });
      onRefresh();
    } catch (err) {
      addToast('error', 'Update failed', err.message);
    }
  }

  async function handlePresetChange(preset) {
    try {
      await api.patch(`/gateways/${gateway.id}`, { notifications: { preset } });
      onRefresh();
    } catch (err) {
      addToast('error', 'Update failed', err.message);
    }
  }

  async function handlePermissionChange(perm) {
    try {
      await api.patch(`/gateways/${gateway.id}`, { commandPermission: perm });
      onRefresh();
    } catch (err) {
      addToast('error', 'Update failed', err.message);
    }
  }

  async function handleDelete() {
    try {
      await api.delete(`/gateways/${gateway.id}`);
      addToast('info', `${GATEWAY_LABELS[gateway.type]} gateway removed`);
      onRefresh();
    } catch (err) {
      addToast('error', 'Delete failed', err.message);
    }
  }

  const currentPreset = gateway.notifications?.preset || 'critical';

  return (
    <div className="flex flex-col rounded-lg border border-border-subtle bg-surface-1 overflow-hidden min-w-[220px]">
      {/* Header */}
      <div className="flex items-center gap-2.5 px-4 py-3 border-b border-border-subtle">
        <StatusDot status={gateway.connected ? 'running' : 'crashed'} size="sm" />
        <Icon size={13} className="text-text-2" />
        <span className="text-[13px] font-semibold text-text-0 font-sans">{GATEWAY_LABELS[gateway.type]}</span>
        <div className="flex-1" />
        {gateway.connected ? (
          <Badge variant="success" className="text-2xs gap-1"><PlugZap size={8} /> Connected</Badge>
        ) : gateway.enabled ? (
          <Badge variant="warning" className="text-2xs">Disconnected</Badge>
        ) : (
          <Badge variant="default" className="text-2xs">Disabled</Badge>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 flex flex-col px-4 py-3 min-h-[140px]">

        {/* Connected state */}
        {gateway.connected && !settingToken && (
          <>
            <div className="flex items-center gap-1.5 h-8 px-2.5 bg-success/8 border border-success/20 rounded-md text-2xs font-sans text-success mb-3">
              <Check size={10} /> Gateway active
              {gateway.botUsername && <span className="text-text-4 ml-1">@{gateway.botUsername}</span>}
              {gateway.botTag && <span className="text-text-4 ml-1">{gateway.botTag}</span>}
            </div>

            {/* Channel / Chat ID */}
            <div className="mb-3">
              <label className="text-2xs font-semibold text-text-3 font-sans mb-1.5 block">
                {gateway.type === 'slack' ? 'Channel' : 'Chat ID'}
              </label>
              {gateway.chatId ? (
                <div className="flex items-center gap-2">
                  <code className="flex-1 flex items-center h-7 px-2 bg-surface-0 border border-border-subtle rounded-md text-2xs font-mono text-text-2">
                    {gateway.type === 'slack' && channels.length > 0
                      ? `#${channels.find((c) => c.id === gateway.chatId)?.name || gateway.chatId}`
                      : gateway.chatId}
                  </code>
                  <button
                    onClick={async () => {
                      try { await api.patch(`/gateways/${gateway.id}`, { chatId: null }); onRefresh(); }
                      catch (err) { addToast('error', 'Failed', err.message); }
                    }}
                    className="text-2xs text-text-4 hover:text-text-1 cursor-pointer font-sans"
                  >Change</button>
                </div>
              ) : gateway.type === 'slack' && channels.length > 0 ? (
                <select
                  onChange={async (e) => {
                    if (!e.target.value) return;
                    try {
                      await api.patch(`/gateways/${gateway.id}`, { chatId: e.target.value });
                      onRefresh();
                    } catch (err) { addToast('error', 'Failed to set channel', err.message); }
                  }}
                  className="w-full h-7 px-2 text-2xs bg-surface-0 border border-border-subtle rounded-md text-text-0 font-sans focus:outline-none focus:ring-1 focus:ring-accent cursor-pointer"
                  defaultValue=""
                >
                  <option value="" disabled>Select a channel...</option>
                  {channels.map((c) => (
                    <option key={c.id} value={c.id}>#{c.name}</option>
                  ))}
                </select>
              ) : (
                <div className="text-2xs text-warning font-sans">
                  {gateway.type === 'slack'
                    ? 'No channels found — invite the bot to a channel first.'
                    : 'Send a message to the bot to auto-capture, or enter manually:'}
                  <input
                    placeholder={gateway.type === 'slack' ? 'C0123456789' : 'Chat ID'}
                    className="mt-1 w-full h-7 px-2 text-2xs bg-surface-0 border border-border rounded-md text-text-0 font-mono placeholder:text-text-4 focus:outline-none focus:ring-1 focus:ring-accent"
                    onKeyDown={async (e) => {
                      if (e.key === 'Enter' && e.target.value.trim()) {
                        try {
                          await api.patch(`/gateways/${gateway.id}`, { chatId: e.target.value.trim() });
                          onRefresh();
                        } catch (err) { addToast('error', 'Failed to set channel', err.message); }
                      }
                    }}
                  />
                </div>
              )}
            </div>

            {/* Notification preset */}
            <div className="mb-3">
              <label className="text-2xs font-semibold text-text-3 font-sans mb-1.5 block">Notifications</label>
              <div className="flex bg-surface-0 rounded-md p-0.5 border border-border-subtle">
                {NOTIFICATION_PRESETS.map((p) => (
                  <button
                    key={p}
                    onClick={() => handlePresetChange(p)}
                    className={cn(
                      'flex-1 px-2 py-1.5 text-2xs font-semibold font-sans rounded transition-all cursor-pointer capitalize',
                      currentPreset === p ? 'bg-accent/15 text-accent shadow-sm' : 'text-text-3 hover:text-text-1',
                    )}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>

            {/* Command permissions */}
            <div className="mb-3">
              <label className="text-2xs font-semibold text-text-3 font-sans mb-1.5 block">Commands</label>
              <div className="flex bg-surface-0 rounded-md p-0.5 border border-border-subtle">
                {['full', 'read-only'].map((p) => (
                  <button
                    key={p}
                    onClick={() => handlePermissionChange(p)}
                    className={cn(
                      'flex-1 px-2 py-1.5 text-2xs font-semibold font-sans rounded transition-all cursor-pointer capitalize',
                      (gateway.commandPermission || 'full') === p ? 'bg-accent/15 text-accent shadow-sm' : 'text-text-3 hover:text-text-1',
                    )}
                  >
                    {p === 'full' ? 'Full Access' : 'Read Only'}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {/* Not connected, not editing — show state */}
        {!gateway.connected && !settingToken && (
          <>
            <div className="text-xs text-text-3 font-sans mb-2">
              {!gateway.enabled ? 'Gateway is disabled.' : gateway.hasCredentials ? 'Tokens saved — click Connect.' : 'Configure bot token to connect.'}
            </div>
            {!gateway.hasCredentials && (
              <button
                onClick={() => setShowGuide(true)}
                className="flex items-center gap-1.5 text-2xs text-accent hover:text-accent/80 font-sans font-medium cursor-pointer mb-2"
              >
                <HelpCircle size={11} />
                How to set up
                <ExternalLink size={9} />
              </button>
            )}
          </>
        )}

        {/* Setup guide sheet */}
        <GatewaySetupGuide type={gateway.type} open={showGuide} onOpenChange={setShowGuide} />

        <div className="flex-1" />

        {/* Token input form */}
        {settingToken && (
          <div className="space-y-2.5 pt-1">
            {/* Open setup guide */}
            <button
              onClick={() => setShowGuide(true)}
              className="flex items-center gap-1.5 text-2xs text-accent hover:text-accent/80 font-sans font-medium cursor-pointer"
            >
              <HelpCircle size={11} />
              Where do I get these?
            </button>
            <div>
              <label className="text-2xs font-semibold text-text-2 font-sans mb-1.5 block">Bot Token</label>
              <div className="relative">
                <input
                  value={tokenInput}
                  onChange={(e) => setTokenInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !isSlack && handleSaveToken()}
                  type={showToken ? 'text' : 'password'}
                  placeholder={GATEWAY_PLACEHOLDERS[gateway.type]}
                  className="w-full h-9 px-3 pr-9 text-xs bg-surface-0 border border-border rounded-md text-text-0 font-mono placeholder:text-text-4 focus:outline-none focus:ring-1 focus:ring-accent"
                  autoFocus
                />
                <button onClick={() => setShowToken(!showToken)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-4 hover:text-text-2 cursor-pointer">
                  {showToken ? <EyeOff size={12} /> : <Eye size={12} />}
                </button>
              </div>
            </div>
            {isSlack && (
              <div>
                <label className="text-2xs font-semibold text-text-2 font-sans mb-1.5 block">App Token (Socket Mode)</label>
                <input
                  value={appTokenInput}
                  onChange={(e) => setAppTokenInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSaveToken()}
                  type={showToken ? 'text' : 'password'}
                  placeholder="xapp-..."
                  className="w-full h-9 px-3 text-xs bg-surface-0 border border-border rounded-md text-text-0 font-mono placeholder:text-text-4 focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>
            )}
            <div className="flex gap-2">
              <Button variant="primary" size="sm" onClick={handleSaveToken} disabled={!tokenInput.trim()} className="flex-1 h-8 text-xs">
                Save Token
              </Button>
              <Button variant="ghost" size="sm" onClick={() => { setSettingToken(false); setTokenInput(''); setAppTokenInput(''); }} className="h-8 text-xs px-3">
                Cancel
              </Button>
            </div>
          </div>
        )}

        {/* Bottom actions */}
        {!settingToken && (
          <div className="flex gap-2 mt-2">
            {!gateway.connected && (
              <Button variant="primary" size="sm" onClick={() => setSettingToken(true)} className="flex-1 h-7 text-2xs gap-1.5">
                <Key size={11} />
                {gateway.enabled ? 'Set Token' : 'Configure'}
              </Button>
            )}
            {gateway.connected && (
              <>
                <Button variant="secondary" size="sm" onClick={handleTest} disabled={testing} className="flex-1 h-7 text-2xs gap-1.5">
                  <TestTube size={11} />
                  {testing ? 'Sending...' : 'Test'}
                </Button>
                <Button variant="secondary" size="sm" onClick={() => setSettingToken(true)} className="h-7 text-2xs px-2.5">
                  <Key size={11} />
                </Button>
              </>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={handleToggleConnect}
              disabled={connecting}
              className="h-7 text-2xs px-2.5"
              title={gateway.connected ? 'Disconnect' : 'Connect'}
            >
              {gateway.connected ? <Plug size={11} /> : <PlugZap size={11} />}
            </Button>
            <Toggle value={gateway.enabled} onChange={handleToggleEnabled} />
            <button onClick={handleDelete} className="text-text-4 hover:text-danger cursor-pointer p-1" title="Remove gateway">
              <Trash2 size={11} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Add Gateway Button ───────────────────────────────────── */

function AddGatewayCard({ existingTypes, onAdd }) {
  const [open, setOpen] = useState(false);
  const available = ['telegram', 'discord', 'slack'].filter((t) => !existingTypes.includes(t));

  if (available.length === 0) return null;

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border-subtle bg-surface-1/50 hover:bg-surface-1 hover:border-accent/30 min-h-[140px] min-w-[220px] cursor-pointer transition-all group"
      >
        <div className="w-8 h-8 rounded-full bg-accent/8 group-hover:bg-accent/15 flex items-center justify-center mb-2 transition-colors">
          <Plus size={14} className="text-accent" />
        </div>
        <span className="text-2xs font-semibold text-text-3 group-hover:text-text-1 font-sans transition-colors">Add Gateway</span>
      </button>
    );
  }

  return (
    <div className="flex flex-col rounded-lg border border-accent/30 bg-surface-1 overflow-hidden min-w-[220px]">
      <div className="flex items-center gap-2.5 px-4 py-3 border-b border-border-subtle">
        <Radio size={13} className="text-accent" />
        <span className="text-[13px] font-semibold text-text-0 font-sans">Add Gateway</span>
        <div className="flex-1" />
        <button onClick={() => setOpen(false)} className="text-text-4 hover:text-text-1 cursor-pointer"><X size={12} /></button>
      </div>
      <div className="p-3 space-y-2">
        {available.map((type) => {
          const Icon = GATEWAY_ICONS[type];
          return (
            <button
              key={type}
              onClick={() => { onAdd(type); setOpen(false); }}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md bg-surface-0 hover:bg-accent/8 border border-border-subtle hover:border-accent/20 cursor-pointer transition-all group"
            >
              <Icon size={14} className="text-text-3 group-hover:text-accent" />
              <span className="text-xs font-medium text-text-1 group-hover:text-accent font-sans">{GATEWAY_LABELS[type]}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ── Main Settings View ────────────────────────────────────── */

export default function SettingsView() {
  const [providers, setProviders] = useState([]);
  const [config, setConfig] = useState(null);
  const [daemonInfo, setDaemonInfo] = useState(null);
  const [gwList, setGwList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [folderBrowserOpen, setFolderBrowserOpen] = useState(false);
  const addToast = useGrooveStore((s) => s.addToast);
  const marketplaceUser = useGrooveStore((s) => s.marketplaceUser);
  const marketplaceAuthenticated = useGrooveStore((s) => s.marketplaceAuthenticated);
  const marketplaceLogin = useGrooveStore((s) => s.marketplaceLogin);
  const marketplaceLogout = useGrooveStore((s) => s.marketplaceLogout);

  function loadProviders() {
    api.get('/providers').then((d) => setProviders(Array.isArray(d) ? d : [])).catch(() => {});
  }

  function loadGateways() {
    api.get('/gateways').then((d) => setGwList(Array.isArray(d) ? d : [])).catch(() => {});
  }

  useEffect(() => {
    Promise.all([api.get('/providers'), api.get('/config'), api.get('/status'), api.get('/gateways')])
      .then(([p, c, s, g]) => { setProviders(Array.isArray(p) ? p : []); setConfig(c); setDaemonInfo(s); setGwList(Array.isArray(g) ? g : []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  async function addGateway(type) {
    try {
      await api.post('/gateways', { type });
      addToast('success', `${GATEWAY_LABELS[type]} gateway added`);
      loadGateways();
    } catch (err) {
      addToast('error', 'Failed to add gateway', err.message);
    }
  }

  async function updateConfig(key, value) {
    try {
      const updated = await api.patch('/config', { [key]: value });
      setConfig(updated);
    } catch (err) {
      addToast('error', 'Update failed', err.message);
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col h-full">
        <div className="h-12 bg-surface-1 border-b border-border" />
        <div className="flex-1 p-4 space-y-4">
          <div className="grid grid-cols-4 gap-3">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-40 rounded-lg" />)}</div>
          <div className="grid grid-cols-3 gap-3">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-28 rounded-lg" />)}</div>
        </div>
      </div>
    );
  }

  const connectedCount = providers.filter((p) => {
    if (p.authType === 'local') return p.installed;
    if (p.authType === 'subscription') return p.installed;
    return p.hasKey;
  }).length;

  // Rotation threshold display: 0 = auto, otherwise show as percentage
  const rotationValue = config?.rotationThreshold || 0;
  const rotationDisplay = rotationValue === 0 ? 'auto' : `${Math.round(rotationValue * 100)}%`;

  return (
    <div className="flex flex-col h-full">

      {/* ═══════ HEADER BAR ═══════ */}
      <div className="flex items-center gap-4 px-4 py-2.5 bg-surface-1 border-b border-border flex-shrink-0">
        <h2 className="text-sm font-semibold text-text-0 font-sans">Settings</h2>
        <div className="flex-1" />

        <div className="flex items-center gap-4 text-2xs text-text-3 font-sans">
          {daemonInfo?.version && <span>v{daemonInfo.version}</span>}
          {daemonInfo?.port && <span>:{daemonInfo.port}</span>}
          {daemonInfo?.uptime > 0 && <span>Up {fmtUptime(daemonInfo.uptime)}</span>}
        </div>

        <div className="w-px h-4 bg-border-subtle" />

        {marketplaceAuthenticated ? (
          <div className="flex items-center gap-2.5">
            <ProfilePic user={marketplaceUser} />
            <span className="text-xs font-medium text-text-0 font-sans">{marketplaceUser?.displayName || 'User'}</span>
            <button onClick={marketplaceLogout} className="text-2xs text-text-4 hover:text-text-1 cursor-pointer font-sans flex items-center gap-1">
              <LogOut size={10} /> Sign out
            </button>
          </div>
        ) : (
          <Button variant="ghost" size="sm" onClick={marketplaceLogin} className="h-7 text-2xs gap-1.5 text-text-3">
            <LogIn size={11} /> Sign in
          </Button>
        )}

        <StatusDot status="running" size="sm" />
      </div>

      {/* ═══════ SCROLLABLE BODY ═══════ */}
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">

          {/* ═══════ PROVIDERS ═══════ */}
          <div>
            <div className="flex items-center gap-2 mb-2.5 px-0.5">
              <span className="text-2xs font-semibold text-text-3 font-sans uppercase tracking-wider">Providers</span>
              <div className="flex-1 h-px bg-border-subtle" />
              <span className="text-2xs text-text-4 font-sans">{connectedCount}/{providers.length} connected</span>
            </div>
            <div className="grid grid-cols-4 gap-3">
              {providers.map((p) => (
                <ProviderCard key={p.id} provider={p} onKeyChange={loadProviders} />
              ))}
            </div>
          </div>

          {/* ═══════ GATEWAYS ═══════ */}
          <div>
            <div className="flex items-center gap-2 mb-2.5 px-0.5">
              <span className="text-2xs font-semibold text-text-3 font-sans uppercase tracking-wider">Gateways</span>
              <div className="flex-1 h-px bg-border-subtle" />
              <span className="text-2xs text-text-4 font-sans">
                {gwList.filter((g) => g.connected).length}/{gwList.length} connected
              </span>
            </div>
            <div className="grid grid-cols-4 gap-3">
              {gwList.map((gw) => (
                <GatewayCard key={gw.id} gateway={gw} onRefresh={loadGateways} />
              ))}
              <AddGatewayCard existingTypes={gwList.map((g) => g.type)} onAdd={addGateway} />
            </div>
          </div>

          {/* ═══════ CONFIGURATION ═══════ */}
          {config && (
            <div>
              <div className="flex items-center gap-2 mb-2.5 px-0.5">
                <span className="text-2xs font-semibold text-text-3 font-sans uppercase tracking-wider">Configuration</span>
                <div className="flex-1 h-px bg-border-subtle" />
                <span className="text-2xs text-text-4 font-sans">Auto-saves</span>
              </div>
              <div className="grid grid-cols-3 gap-3">

                <ConfigCard icon={Cpu} label="Default Provider" description="Provider used when spawning new agents.">
                  <select
                    value={config.defaultProvider || 'claude-code'}
                    onChange={(e) => updateConfig('defaultProvider', e.target.value)}
                    className="w-full h-8 px-2.5 text-xs bg-surface-0 border border-border-subtle rounded-md text-text-0 font-mono focus:outline-none focus:ring-1 focus:ring-accent cursor-pointer"
                  >
                    {providers.filter((p) => p.installed || p.hasKey).map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </ConfigCard>

                <ConfigCard icon={FolderOpen} label="Working Directory" description="Default root directory for new agents.">
                  <div className="flex items-center gap-1.5">
                    <code className="flex-1 h-8 px-2 flex items-center bg-surface-0 border border-border-subtle rounded-md text-2xs font-mono text-text-2 truncate min-w-0">
                      {config.defaultWorkingDir || 'Project root'}
                    </code>
                    <Button variant="secondary" size="sm" onClick={() => setFolderBrowserOpen(true)} className="h-8 px-2 flex-shrink-0">
                      <FolderSearch size={12} />
                    </Button>
                  </div>
                </ConfigCard>

                <ConfigCard icon={Gauge} label="Rotation Threshold" description="Context usage that triggers auto-rotation.">
                  <div className="flex bg-surface-0 rounded-md p-0.5 border border-border-subtle">
                    {['auto', '50%', '65%', '75%', '85%'].map((opt) => {
                      const val = opt === 'auto' ? 0 : parseInt(opt, 10) / 100;
                      const isActive = rotationValue === val;
                      return (
                        <button
                          key={opt}
                          onClick={() => updateConfig('rotationThreshold', val)}
                          className={cn(
                            'flex-1 px-2 py-1.5 text-2xs font-semibold font-sans rounded transition-all cursor-pointer',
                            isActive ? 'bg-accent/15 text-accent shadow-sm' : 'text-text-3 hover:text-text-1',
                          )}
                        >
                          {opt === 'auto' ? 'Auto' : opt}
                        </button>
                      );
                    })}
                  </div>
                </ConfigCard>

                <ConfigCard icon={ShieldCheck} label="QC Threshold" description="Running agents count that triggers auto-QC.">
                  <div className="flex bg-surface-0 rounded-md p-0.5 border border-border-subtle">
                    {[2, 3, 4, 6, 8].map((n) => {
                      const isActive = (config.qcThreshold || 2) === n;
                      return (
                        <button
                          key={n}
                          onClick={() => updateConfig('qcThreshold', n)}
                          className={cn(
                            'flex-1 px-2 py-1.5 text-2xs font-semibold font-sans rounded transition-all cursor-pointer',
                            isActive ? 'bg-accent/15 text-accent shadow-sm' : 'text-text-3 hover:text-text-1',
                          )}
                        >
                          {n}
                        </button>
                      );
                    })}
                  </div>
                </ConfigCard>

                <ConfigCard icon={Users} label="Max Agents" description="Concurrent agent limit. 0 = unlimited.">
                  <div className="flex bg-surface-0 rounded-md p-0.5 border border-border-subtle">
                    {[0, 4, 8, 12, 20].map((n) => {
                      const isActive = (config.maxAgents || 0) === n;
                      return (
                        <button
                          key={n}
                          onClick={() => updateConfig('maxAgents', n)}
                          className={cn(
                            'flex-1 px-2 py-1.5 text-2xs font-semibold font-sans rounded transition-all cursor-pointer',
                            isActive ? 'bg-accent/15 text-accent shadow-sm' : 'text-text-3 hover:text-text-1',
                          )}
                        >
                          {n === 0 ? '\u221E' : n}
                        </button>
                      );
                    })}
                  </div>
                </ConfigCard>

                <ConfigCard icon={Newspaper} label="Journalist Interval" description="Seconds between synthesis cycles.">
                  <div className="flex bg-surface-0 rounded-md p-0.5 border border-border-subtle">
                    {[60, 120, 300, 600].map((n) => {
                      const isActive = (config.journalistInterval || 120) === n;
                      const label = n < 60 ? `${n}s` : `${n / 60}m`;
                      return (
                        <button
                          key={n}
                          onClick={() => updateConfig('journalistInterval', n)}
                          className={cn(
                            'flex-1 px-2 py-1.5 text-2xs font-semibold font-sans rounded transition-all cursor-pointer',
                            isActive ? 'bg-accent/15 text-accent shadow-sm' : 'text-text-3 hover:text-text-1',
                          )}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </ConfigCard>

              </div>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Folder Browser Modal */}
      <FolderBrowser
        open={folderBrowserOpen}
        onOpenChange={setFolderBrowserOpen}
        currentPath={config?.defaultWorkingDir || '/'}
        onSelect={(dir) => updateConfig('defaultWorkingDir', dir)}
      />
    </div>
  );
}
