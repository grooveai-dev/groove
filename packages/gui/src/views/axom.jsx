// GROOVE GUI v2 — Axom View
// FSL-1.1-Apache-2.0 — see LICENSE
//
// The Axom provider tab (M2: shell + onboarding + raw ticker + hot input).
// House laws from the integration contract: every rendered claim traces to an
// event; interrupt feedback ("⚡ heard") comes from the `interrupt` EVENT on
// the stream, never from our own POST succeeding; the stop button's pressed
// state releases on `pipeline_done` even without `stop_effected` and says
// "resolved before stop" (§7 — a stuck pressed button is a small
// fail-deceptive).

import { useEffect, useMemo, useRef, useState } from 'react';
import { Atom, Zap, OctagonX, Plug, Radio, MessageSquareQuote, Shirt, TriangleAlert, Trophy, Download, Square, Play, Plus, MemoryStick, HardDrive, Cpu, Gauge, CheckCircle2, Globe, Copy, Settings2, ArrowLeft, Loader2, ChevronDown, SendHorizontal, X, Wrench, Brain, Power, Unplug } from 'lucide-react';
import { motion } from 'framer-motion';
import { useGrooveStore } from '../stores/groove';
import { axomSessionKey } from '../stores/slices/axom-slice';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Badge } from '../components/ui/badge';
import { StatusDot } from '../components/ui/status-dot';
import { ThinkingIndicator } from '../components/ui/thinking-indicator';
// The Axom conversation renders agent prose with the fleet chat's renderer —
// one look for agent output across the app, not a parallel implementation.
import { StructuredMessage } from '../components/agents/agent-feed';
import { cn } from '../lib/cn';

// ── Onboarding — the front door ─────────────────────────────────────────────

function formatBytes(n) {
  if (!n) return '0 MB';
  return n > 1e9 ? `${(n / 1e9).toFixed(2)} GB` : `${Math.round(n / 1e6)} MB`;
}

// Stat tile per the house dataviz spec: muted label, mono numeral, optional
// sub-line and severity meter (fill carries state; track is a step of the
// same surface ramp). Value color follows measurement, never optimism — and
// state never rides color alone (the verdict pill carries icon + words).
// `unit` is split off the numeral so the number reads first at a glance.
function HardwareStat({ icon: Icon, label, value, unit, sub, tone = 'text-text-0', meter }) {
  return (
    <div className="relative rounded-lg bg-surface-1 border border-border-subtle px-3.5 py-3 flex flex-col gap-1.5 min-w-0">
      <span className="flex items-center gap-1.5 text-2xs uppercase tracking-[0.12em] text-text-4 font-semibold">
        <Icon size={11} strokeWidth={1.75} /> {label}
      </span>
      <span className="flex items-baseline gap-1 min-w-0">
        <span className={cn('font-mono text-xl font-semibold leading-none tabular-nums truncate', tone)}>{value}</span>
        {unit && <span className="text-xs text-text-3 font-medium flex-shrink-0">{unit}</span>}
      </span>
      {sub && <span className="text-2xs text-text-4 truncate">{sub}</span>}
      {meter && (
        <div className="h-[3px] mt-0.5 rounded-full bg-surface-4 overflow-hidden">
          <div
            className={cn('h-full rounded-full transition-[width] duration-700 ease-out', meter.tone)}
            style={{ width: `${meter.pct}%` }}
          />
        </div>
      )}
    </div>
  );
}

const VERDICT_COPY = {
  ready: {
    icon: CheckCircle2,
    pill: 'Ready for local Axom',
    tone: 'text-success border-success/30 bg-success/10',
    meterTone: 'bg-success',
    detail: 'Meets the recommended spec — expect a comfortable ride.',
  },
  marginal: {
    icon: Gauge,
    pill: 'Meets the minimum',
    tone: 'text-warning border-warning/30 bg-warning/10',
    meterTone: 'bg-warning',
    detail: 'Local Axom will run, but expect slower turns and tight memory. Close heavy apps first.',
  },
  insufficient: {
    icon: TriangleAlert,
    pill: 'Not enough memory',
    tone: 'text-danger border-danger/30 bg-danger/10',
    meterTone: 'bg-danger',
    detail: 'Loading the 4 GB chassis here risks freezing the whole machine — so GROOVE won’t. Connect to an Axom on a capable machine instead; same tab, same experience.',
  },
};

const FEATURE_CHIPS = [
  { icon: Shirt, label: 'Hot-swap skill leaves' },
  { icon: Zap, label: 'Steer it mid-thought' },
  { icon: Trophy, label: 'Answers that crystallize' },
  { icon: HardDrive, label: 'Memory that stays yours' },
];

// ── Connect diagnosis — a failed connect must say WHY ──────────────────────
//
// The trap this exists for: `axom serve` binds 127.0.0.1, so an endpoint
// naming any other host can NEVER be reached directly, no matter how right
// the URL looks. That one fact turns a silent dead workspace into a
// two-second fix, so it is surfaced BEFORE the attempt, not only after it.

function parseEndpoint(raw) {
  const s = (raw || '').trim();
  if (!s) return null;
  let u;
  try { u = new URL(/^[a-z]+:\/\//i.test(s) ? s : `http://${s}`); } catch { return { invalid: true }; }
  const host = u.hostname;
  return {
    invalid: false,
    host,
    port: u.port || (u.protocol === 'https:' ? '443' : '80'),
    local: host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '0.0.0.0',
  };
}

function tunnelFor(parsed) {
  return `ssh -N -L ${parsed.port}:127.0.0.1:${parsed.port} ${parsed.host}`;
}

// Plain language for what the connector reported. The runtime's own error
// text is always shown verbatim alongside this — the reading never replaces
// the evidence.
function diagnose(error, parsed) {
  const e = (error || '').toLowerCase();
  if (parsed && !parsed.local) {
    return {
      cause: `Axom binds 127.0.0.1 only, so ${parsed.host} can't be reached from this machine directly — this address cannot work without a tunnel.`,
      tunnel: true,
    };
  }
  if (e.includes('econnrefused') || e.includes('refused')) {
    return { cause: 'Nothing is listening on that port — the runtime is probably not started.' };
  }
  if (e.includes('enotfound') || e.includes('eai_again') || e.includes('dns')) {
    return { cause: "That hostname doesn't resolve from this machine." };
  }
  if (e.includes('timeout') || e.includes('abort')) {
    return { cause: 'No answer in time — wrong host, or something between here and there is dropping it.' };
  }
  if (e.includes('404') || e.includes('about') || e.includes('json') || e.includes('parse')) {
    return { cause: "Something answered, but it didn't serve /about — that address isn't an Axom runtime." };
  }
  return { cause: "The runtime didn't answer /about." };
}

// Tunnel instruction + copy, used both pre-flight and after a failure.
function TunnelHint({ parsed, onCopy }) {
  const cmd = tunnelFor(parsed);
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs text-text-3 leading-relaxed">
        Run this on this machine first, then connect to{' '}
        <code className="font-mono text-text-2">http://127.0.0.1:{parsed.port}</code> instead:
      </p>
      <div className="flex items-center gap-1.5">
        <code className="flex-1 px-2 py-1 bg-surface-0 border border-border-subtle rounded font-mono text-2xs text-text-2 truncate select-all">
          {cmd}
        </code>
        <button
          onClick={() => onCopy(cmd)}
          className="p-1 rounded text-text-4 hover:text-accent hover:bg-surface-3 transition-colors cursor-pointer"
          title="Copy tunnel command"
        >
          <Copy size={11} />
        </button>
      </div>
    </div>
  );
}

function Onboarding({ onBack }) {
  const axomStatus = useGrooveStore((s) => s.axomStatus);
  const saveAxomEndpoints = useGrooveStore((s) => s.saveAxomEndpoints);
  const startAxomInstall = useGrooveStore((s) => s.startAxomInstall);
  const startAxomInstance = useGrooveStore((s) => s.startAxomInstance);
  const fetchAxomHardware = useGrooveStore((s) => s.fetchAxomHardware);
  const hw = useGrooveStore((s) => s.axomHardware);
  const myEndpoint = useGrooveStore((s) => s.axomMyEndpoint);
  const install = useGrooveStore((s) => s.axomInstall);
  const addToast = useGrooveStore((s) => s.addToast);
  const [url, setUrl] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { fetchAxomHardware(); }, [fetchAxomHardware]);

  const installing = install.phase === 'manifest' || install.phase === 'runtime' || install.phase === 'models';
  const req = hw?.requirements;
  const verdict = hw ? VERDICT_COPY[hw.verdict] : null;
  const canInstall = hw ? hw.verdict !== 'insufficient' && hw.diskOk !== false : true;

  async function installLocally() {
    try {
      await startAxomInstall();
    } catch (err) {
      addToast('error', 'Install could not start', err.message);
    }
  }

  async function startInstance() {
    try {
      await startAxomInstance('default');
    } catch (err) {
      addToast('error', 'Instance failed to start', err.message);
    }
  }

  async function connect() {
    setSaving(true);
    try {
      // Replace rather than append — one configured endpoint at a time in v0,
      // so re-pointing a wrong URL is a single action.
      await saveAxomEndpoints([{ name: 'local', url: url.trim() }]);
      onBack?.();
    } catch (err) {
      addToast('error', 'Could not save endpoint', err.message);
    } finally {
      setSaving(false);
    }
  }

  // Remove the configured endpoint entirely — the way out of a dead one.
  async function disconnect() {
    setSaving(true);
    try {
      await saveAxomEndpoints([]);
      addToast('success', 'Endpoint removed');
    } catch (err) {
      addToast('error', 'Could not remove endpoint', err.message);
    } finally {
      setSaving(false);
    }
  }

  const configured = axomStatus?.endpoints?.[0] || null;

  function copyText(value) {
    navigator.clipboard.writeText(value);
    addToast('success', 'Copied');
  }

  // What the user is typing, read for the bind trap before they commit to it.
  const typed = useMemo(() => parseEndpoint(url), [url]);
  const configuredParsed = useMemo(() => parseEndpoint(configured?.url), [configured?.url]);
  const failure = configured?.status === 'error' ? diagnose(configured.error, configuredParsed) : null;

  const insufficient = hw?.verdict === 'insufficient';
  // Distribution availability is data, not an error. `available === false`
  // means this build has no local-install path yet — the card says so quietly
  // and says nothing else. Undefined means we haven't heard back, so the
  // button waits rather than flashing an action that may not exist.
  const gated = install.available === false;
  const checkingAvailability = install.available === undefined;
  // Coming-soon outranks the RAM floor: telling someone their machine is too
  // small for software they can't obtain is the worst of both messages.
  const connectFirst = gated || insufficient;
  const ramPct = hw && req ? Math.min(100, (hw.totalRamGb / req.recommendedRamGb) * 100) : 0;

  return (
    <div className="h-full axom-hero-bg overflow-y-auto lg:overflow-hidden relative">
      {/* Currently-configured endpoint: state + the way back / the way out */}
      {(onBack || configured) && (
        <div className="absolute top-0 inset-x-0 z-10 flex items-center gap-3 px-6 xl:px-12 py-2.5 border-b border-border-subtle bg-surface-1/70 backdrop-blur">
          {onBack && (
            <button onClick={onBack} className="flex items-center gap-1.5 text-xs text-text-3 hover:text-accent cursor-pointer transition-colors">
              <ArrowLeft size={13} /> Back to workspace
            </button>
          )}
          {configured && (
            <div className="ml-auto flex items-center gap-2 min-w-0">
              <StatusDot status={configured.status === 'connected' ? 'running' : configured.status === 'error' ? 'crashed' : 'starting'} size="sm" />
              <span className="text-xs text-text-3 font-mono truncate max-w-[22rem]" title={configured.error || configured.url}>
                {configured.url}
              </span>
              {configured.status === 'error' && (
                <span className="text-xs text-danger truncate">{configured.error || 'unreachable'}</span>
              )}
              <Button size="sm" variant="ghost" onClick={disconnect} disabled={saving}>Disconnect</Button>
            </div>
          )}
        </div>
      )}
      <div className={cn(
        'min-h-full lg:h-full w-full max-w-[1600px] mx-auto px-6 xl:px-12 py-6 grid grid-cols-1 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)] gap-8 xl:gap-14 items-center',
        (onBack || configured) && 'pt-16',
      )}>

        {/* ── Identity pane — who Axom is, stated once ────────────────── */}
        <motion.div
          initial={{ opacity: 0, x: -14 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
          className="flex flex-col gap-6 min-w-0"
        >
          <div className="flex items-center gap-5 min-w-0">
            {/* Orbiting mark */}
            <div className="relative h-24 w-24 flex-shrink-0 flex items-center justify-center">
              <span aria-hidden className="absolute h-20 w-20 rounded-full bg-accent/20 blur-2xl animate-axom-breathe" />
              <span aria-hidden className="absolute inset-0 animate-axom-orbit">
                <span className="axom-ring absolute inset-0 scale-y-[0.42]" />
              </span>
              <span aria-hidden className="absolute inset-1 animate-axom-orbit-slow">
                <span className="axom-ring absolute inset-0 scale-x-[0.42]" />
              </span>
              <span aria-hidden className="absolute inset-2 rounded-full border border-accent/10" />
              <Atom size={46} strokeWidth={0.9} className="relative text-accent" />
            </div>
            <div className="flex flex-col gap-2 min-w-0">
              <span className="inline-flex items-center gap-2 text-2xs uppercase tracking-[0.22em] text-text-4 font-semibold">
                Sovereign runtime
                <span aria-hidden className="h-px w-8 axom-edge-muted" />
              </span>
              <h2 className="axom-display text-[2.75rem] xl:text-5xl font-semibold tracking-[-0.025em] leading-[1.05]">
                Your own Axom
              </h2>
            </div>
          </div>

          <p className="text-[0.9375rem] text-text-2 leading-relaxed max-w-xl">
            A sovereign AI runtime that lives on your hardware, remembers per
            project, and shows its work — every claim on screen traces to a
            real event underneath.
          </p>

          {/* Capability ledger — one law per row, hairline separated */}
          <div className="max-w-xl rounded-lg border border-border-subtle bg-surface-1/50 divide-y divide-border-subtle overflow-hidden">
            {FEATURE_CHIPS.map(({ icon: Icon, label }) => (
              <span key={label} className="flex items-center gap-3 px-4 py-2.5">
                <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded border border-accent/20 bg-accent/10 text-accent">
                  <Icon size={12} strokeWidth={1.75} />
                </span>
                <span className="text-xs text-text-2 leading-snug">{label}</span>
              </span>
            ))}
          </div>

          <p className="text-xs text-text-4 leading-relaxed max-w-md">
            Axom speaks an open provider protocol — local today, your rack tomorrow, the mesh after that. One socket, every tier.
          </p>
        </motion.div>

        {/* ── Operations pane — what this machine can do about it ──────── */}
        <div className="flex flex-col gap-4 min-w-0">

        {/* ── This machine — readiness, verdict integrated ─────────────── */}
        {hw && (
          <motion.section
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.1, ease: 'easeOut' }}
            className="relative rounded-xl axom-panel border border-border overflow-hidden"
          >
            <span aria-hidden className="absolute inset-x-0 top-0 h-px axom-edge-muted" />
            <div className="px-5 py-4 flex flex-col gap-4">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <span className="flex items-center gap-2 text-2xs uppercase tracking-[0.16em] text-text-3 font-semibold">
                  <Gauge size={12} strokeWidth={1.75} className="text-text-4" />
                  This machine
                </span>
                {verdict && (
                  <span className={cn('inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-xs font-semibold', verdict.tone)}>
                    <verdict.icon size={13} strokeWidth={2} /> {verdict.pill}
                  </span>
                )}
              </div>

              <div className="grid grid-cols-2 xl:grid-cols-4 gap-2.5">
                <HardwareStat
                  icon={MemoryStick} label="Memory" value={hw.totalRamGb} unit="GB"
                  sub={req && `of ${req.recommendedRamGb} GB recommended`}
                  tone={insufficient ? 'text-danger' : hw.verdict === 'marginal' ? 'text-warning' : 'text-success'}
                  meter={verdict && { pct: ramPct, tone: verdict.meterTone }}
                />
                <HardwareStat
                  icon={HardDrive} label="Free disk"
                  value={hw.freeDiskGb == null ? '—' : Math.round(hw.freeDiskGb)}
                  unit={hw.freeDiskGb == null ? null : 'GB'}
                  sub={req && `${req.minDiskGb} GB needed`}
                  tone={hw.diskOk === false ? 'text-danger' : 'text-text-0'}
                />
                <HardwareStat icon={Cpu} label="Processor" value={hw.cpuCores} unit="cores" sub={hw.appleSilicon ? 'Apple Silicon' : hw.arch} />
                <HardwareStat icon={Zap} label="Accelerator" value={hw.gpu ? 'Metal' : '—'} sub={hw.gpu ? 'unified memory' : 'none detected'} />
              </div>

              {verdict && (
                <p className="text-xs text-text-3 leading-relaxed max-w-3xl">
                  {verdict.detail}
                  {hw.diskOk === false && ` Also low on disk: ${Math.round(hw.freeDiskGb)} GB free, ${req?.minDiskGb} GB needed.`}
                </p>
              )}
            </div>
          </motion.section>
        )}

        {/* ── Two paths to an Axom — the machine's verdict picks the primary ── */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.18, ease: 'easeOut' }}
          className="grid md:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2 gap-4 items-stretch"
        >

          {/* Path 1 — run it here */}
          <section className={cn(
            'relative rounded-xl border p-5 flex flex-col gap-3.5 overflow-hidden transition-colors',
            connectFirst ? 'bg-surface-1/60 border-border-subtle' : 'axom-panel border-accent/25',
          )}>
            <span aria-hidden className={cn('absolute inset-x-0 top-0 h-px', connectFirst ? 'axom-edge-muted' : 'axom-edge-accent')} />
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <span className={cn(
                  'flex h-7 w-7 items-center justify-center rounded-md border',
                  connectFirst ? 'bg-surface-2 border-border-subtle text-text-4' : 'bg-accent/10 border-accent/25 text-accent',
                )}>
                  <Download size={14} strokeWidth={1.75} />
                </span>
                <span className={cn('text-sm font-semibold tracking-tight', connectFirst ? 'text-text-3' : 'text-text-0')}>Run it here</span>
              </div>
              {!connectFirst && hw && <Badge variant="accent">recommended here</Badge>}
            </div>
            <p className="text-xs text-text-3 leading-relaxed flex-1">
              One verified download — runtime and models (~{req?.downloadGb ?? 4.4} GB) —
              then your Axom lives on this machine, fully self-contained.
            </p>

            {gated ? (
              <div className="rounded-md border border-border-subtle bg-surface-2/50 px-3 py-3 flex flex-col items-center gap-1.5 text-center">
                <span className="font-mono text-2xs uppercase tracking-[0.2em] text-text-2">
                  {install.unavailableReason || 'Coming soon'}
                </span>
                <span className="text-xs text-text-4 leading-relaxed">
                  Running Axom on your own machine arrives in a future release.
                </span>
              </div>
            ) : insufficient ? (
              <div className="rounded-md bg-surface-2/60 border border-border-subtle px-3 py-2.5 flex items-start gap-2 text-xs text-text-3 leading-relaxed">
                <TriangleAlert size={13} className="flex-shrink-0 mt-0.5 text-text-4" />
                Locked below the {req?.minRamGb} GB memory floor — this machine stays comfortable.
              </div>
            ) : install.phase === 'done' ? (
              <Button variant="primary" size="lg" onClick={startInstance} className="w-full">
                <Atom size={15} className="mr-1.5" /> Start your Axom
              </Button>
            ) : installing ? (
              <div className="rounded-md bg-surface-1 border border-border-subtle px-3 py-2.5 flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2 text-xs text-text-2">
                  <span className="truncate">{install.phase === 'models' ? `Downloading ${install.file}` : install.phase === 'runtime' ? 'Installing runtime…' : 'Fetching manifest…'}</span>
                  {install.totalBytes > 0 && (
                    <span className="font-mono text-2xs text-text-4 tabular-nums flex-shrink-0">
                      {formatBytes(install.receivedBytes)} / {formatBytes(install.totalBytes)}
                    </span>
                  )}
                </div>
                {install.totalBytes > 0 && (
                  <div className="h-[3px] rounded-full bg-surface-4 overflow-hidden">
                    <div
                      className="h-full bg-accent rounded-full transition-[width] duration-500 ease-out"
                      style={{ width: `${Math.min(100, (install.receivedBytes / install.totalBytes) * 100)}%` }}
                    />
                  </div>
                )}
              </div>
            ) : (
              <Button
                variant="primary" size="lg" onClick={installLocally}
                disabled={!canInstall || checkingAvailability}
                className="w-full"
              >
                <Download size={15} className="mr-1.5" /> Install Axom locally
              </Button>
            )}
            {install.phase === 'error' && (
              <p className="flex items-start gap-1.5 text-xs text-danger leading-relaxed">
                <TriangleAlert size={13} className="flex-shrink-0 mt-0.5" /> {install.error}
              </p>
            )}
          </section>

          {/* Path 2 — connect to one */}
          <section className={cn(
            'relative rounded-xl border p-5 flex flex-col gap-3.5 overflow-hidden transition-colors',
            connectFirst ? 'axom-panel border-accent/25' : 'bg-surface-1/60 border-border-subtle',
          )}>
            <span aria-hidden className={cn('absolute inset-x-0 top-0 h-px', connectFirst ? 'axom-edge-accent' : 'axom-edge-muted')} />
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <span className={cn(
                  'flex h-7 w-7 items-center justify-center rounded-md border',
                  connectFirst ? 'bg-accent/10 border-accent/25 text-accent' : 'bg-surface-2 border-border-subtle text-text-3',
                )}>
                  <Globe size={14} strokeWidth={1.75} />
                </span>
                <span className="text-sm font-semibold tracking-tight text-text-0">Connect to an Axom</span>
              </div>
              {connectFirst && <Badge variant="accent">recommended here</Badge>}
            </div>

            <div className="flex flex-col gap-2">
              <p className="text-2xs uppercase tracking-[0.12em] text-text-4 font-semibold">Enter endpoint</p>
              <div className="flex gap-2">
                <Input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="Paste an Axom endpoint…"
                  className="flex-1 font-mono text-xs"
                />
                <Button variant={connectFirst ? 'primary' : 'secondary'} onClick={connect} disabled={saving || !url.trim()}>
                  <Plug size={14} className="mr-1.5" />
                  {saving ? 'Connecting…' : 'Connect'}
                </Button>
              </div>
              {typed?.invalid && (
                <p className="text-xs text-danger leading-relaxed">That isn't a URL GROOVE can parse.</p>
              )}

              {/* Pre-flight: the bind trap, caught before the dead workspace */}
              {typed && !typed.invalid && !typed.local && (
                <div className="rounded-md border border-warning/25 bg-warning/[0.06] px-3 py-2.5 flex flex-col gap-1.5">
                  <span className="flex items-center gap-1.5 text-xs font-semibold text-warning">
                    <TriangleAlert size={12} /> {typed.host} can't be reached directly
                  </span>
                  <TunnelHint parsed={typed} onCopy={copyText} />
                </div>
              )}

              {/* Post-flight: why the configured endpoint is dead */}
              {failure && (
                <div className="rounded-md border border-danger/25 bg-danger/[0.06] px-3 py-2.5 flex flex-col gap-1.5">
                  <span className="flex items-center gap-1.5 text-xs font-semibold text-danger">
                    <TriangleAlert size={12} /> Can't reach {configured.url}
                  </span>
                  <p className="text-xs text-text-2 leading-relaxed">{failure.cause}</p>
                  {configured.error && (
                    <code className="font-mono text-2xs text-text-4 break-all">{configured.error}</code>
                  )}
                  {failure.tunnel && configuredParsed && (
                    <TunnelHint parsed={configuredParsed} onCopy={copyText} />
                  )}
                </div>
              )}

              <p className="text-xs text-text-4 leading-relaxed">
                Copied from another GROOVE's "My endpoint", over your own secure channel.
              </p>
            </div>

            {myEndpoint && (
              <div className="flex flex-col gap-2 mt-auto pt-3.5 border-t border-border-subtle">
                <div className="flex items-center gap-1.5">
                  <p className="text-2xs uppercase tracking-[0.12em] text-text-4 font-semibold">My endpoint</p>
                  <StatusDot status={myEndpoint.running ? 'running' : 'completed'} size="sm" />
                  <span className="text-2xs text-text-4">{myEndpoint.running ? 'live' : 'idle'}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <code className="flex-1 px-2 py-1.5 bg-surface-0 border border-border-subtle rounded font-mono text-xs text-text-1 truncate select-all">
                    {myEndpoint.url}
                  </code>
                  <Button
                    size="sm"
                    onClick={() => { navigator.clipboard.writeText(myEndpoint.url); addToast('success', 'Endpoint copied'); }}
                  >
                    <Copy size={12} className="mr-1" /> Copy
                  </Button>
                </div>
                <p className="text-xs text-text-4 leading-relaxed">
                  {myEndpoint.running ? 'Your Axom is live here.' : 'Where your Axom listens once started.'}{' '}
                  Binds to this machine only — from another machine, tunnel it:
                </p>
                <div className="flex items-center gap-1.5">
                  <code className="flex-1 px-2 py-1 bg-surface-0 border border-border-subtle rounded font-mono text-2xs text-text-3 truncate select-all">
                    {myEndpoint.tunnelCommand}
                  </code>
                  <button
                    onClick={() => { navigator.clipboard.writeText(myEndpoint.tunnelCommand); addToast('success', 'Tunnel command copied'); }}
                    className="p-1 rounded text-text-4 hover:text-accent hover:bg-surface-3 transition-colors cursor-pointer"
                    title="Copy tunnel command"
                  >
                    <Copy size={11} />
                  </button>
                </div>
              </div>
            )}
          </section>
        </motion.div>
        </div>
      </div>
    </div>
  );
}

// ── Header — the runtime wears its receipts ────────────────────────────────
//
// Monochrome discipline: identity and capability facts are mono ink on the
// surface, not filled badges. Hue is reserved for things that are genuinely
// STATE — an unreachable endpoint, schema drift, a contract anomaly.

// Runtime lifecycle — scoped to the runtime, deliberately far from the input
// row so it never competes with turn-stop. What's offered depends on what we
// can actually honor: a runtime GROOVE spawned can be shut down; one on
// another machine can only be let go of. When Axom ships a /shutdown verb the
// remote branch gains a real control — a swap, not a redesign.
const LIFECYCLE_LABEL = { idle: 'Shut down', confirm: 'Confirm', force: 'Force stop', busy: 'Stopping…' };

function RuntimeLifecycle({ endpoint }) {
  const stopAxomInstance = useGrooveStore((s) => s.stopAxomInstance);
  const shutdownAxomRuntime = useGrooveStore((s) => s.shutdownAxomRuntime);
  const saveAxomEndpoints = useGrooveStore((s) => s.saveAxomEndpoints);
  const addToast = useGrooveStore((s) => s.addToast);
  const [phase, setPhase] = useState('idle'); // idle | confirm | force | busy
  const [note, setNote] = useState(null);

  // A runtime GROOVE spawned is stopped through the instance API — a real
  // process kill that also cleans up our own bookkeeping. Anything else goes
  // through §14, which reaches runtimes no signal of ours ever could.
  const managed = !!endpoint.managed && !!endpoint.instanceId;

  useEffect(() => {
    if (phase !== 'confirm' && phase !== 'force') return;
    const t = setTimeout(() => setPhase('idle'), 5000);
    return () => clearTimeout(t);
  }, [phase]);

  async function shutdown(force) {
    setPhase('busy');
    try {
      if (managed) {
        await stopAxomInstance(endpoint.instanceId);
      } else {
        // §14 outcomes come back as data, not exceptions — they are things
        // this UI must SAY, so they never travel through the catch.
        const result = await shutdownAxomRuntime(endpoint.name, { force });

        // A turn is in flight. The contract allows forcing, but forcing
        // silently would kill work the user never agreed to lose, so the
        // escalation is offered rather than taken.
        if (result.turnInFlight) {
          setNote('turn in flight');
          setPhase('force');
          addToast('warning', 'A turn is in flight', 'Force stop to end it anyway — that turn will not finish.');
          return;
        }

        // Too old for §14. Never claim the runtime is gone; it is very much
        // still running, and pretending otherwise is the fake kill switch we
        // agreed never to ship.
        if (result.unsupported) {
          setNote('no remote shutdown');
          setPhase('idle');
          addToast('error', 'This runtime is still running',
            "It predates remote shutdown, so GROOVE can't stop it from here — stop it on the machine it runs on.");
          return;
        }
      }
      addToast('success', force ? 'Runtime force-stopped' : 'Runtime shutting down');
      setNote(null);
      setPhase('idle');
    } catch (err) {
      setPhase('idle');
      addToast('error', 'Shut down failed', err.message);
    }
  }

  async function disconnect() {
    try {
      await saveAxomEndpoints([]);
      addToast('success', 'Disconnected', 'The runtime keeps running — GROOVE just stopped pointing at it.');
    } catch (err) {
      addToast('error', 'Disconnect failed', err.message);
    }
  }

  const armed = phase === 'confirm' || phase === 'force';

  return (
    <div className="flex items-center gap-1">
      {note && (
        <span className={cn('font-mono text-2xs', phase === 'force' ? 'text-warning' : 'text-text-4')}>
          {note}
        </span>
      )}
      {!managed && (
        <button
          onClick={disconnect}
          className="flex items-center gap-1.5 h-7 px-2 rounded-md text-2xs font-medium text-text-4 hover:text-text-1 hover:bg-surface-2 transition-colors cursor-pointer"
          title="Stop pointing at this endpoint. The runtime keeps running."
        >
          <Unplug size={12} /> Disconnect
        </button>
      )}
      <button
        onClick={() => {
          if (phase === 'idle') { setPhase('confirm'); return; }
          if (phase === 'confirm') shutdown(false);
          if (phase === 'force') shutdown(true);
        }}
        disabled={phase === 'busy'}
        className={cn(
          'flex items-center gap-1.5 h-7 px-2 rounded-md text-2xs font-medium transition-colors cursor-pointer',
          'disabled:opacity-40 disabled:pointer-events-none',
          armed ? 'bg-danger/10 text-danger' : 'text-text-4 hover:text-text-1 hover:bg-surface-2',
        )}
        title={managed
          ? 'Stop the local runtime GROOVE started — its port is released and sessions end'
          : 'Ask this runtime to shut itself down (§14). It may refuse while a turn is in flight.'}
      >
        <Power size={12} /> {LIFECYCLE_LABEL[phase]}
      </button>
    </div>
  );
}

function RuntimeHeader({ endpoint, anomalies, onSetup, tickerOpen, onToggleTicker, eventCount }) {
  const addToast = useGrooveStore((s) => s.addToast);
  const about = endpoint.about;
  const dotStatus = endpoint.status === 'connected' ? 'running'
    : endpoint.status === 'connecting' ? 'starting' : 'crashed';
  const facts = [
    about?.family,
    about?.record?.benchmark && `${about.record['pass@1']} ${about.record.benchmark}`,
    about?.narrator && `narrator ${about.narrator}`,
  ].filter(Boolean);

  return (
    <div className="flex-shrink-0 h-10 border-b border-border-subtle bg-surface-1 px-3 flex items-center gap-3">
      <div className="flex items-center gap-2 min-w-0 flex-shrink-0">
        <StatusDot status={dotStatus} size="sm" />
        <span className="text-xs font-semibold text-text-0 truncate">{endpoint.name}</span>
        <button
          onClick={() => { navigator.clipboard.writeText(endpoint.url); addToast('success', 'Endpoint copied'); }}
          className="font-mono text-2xs text-text-4 hover:text-accent truncate max-w-[15rem] cursor-pointer transition-colors"
          title="Copy endpoint URL"
        >
          {endpoint.url}
        </button>
      </div>

      {facts.length > 0 && (
        <span className="hidden lg:flex items-center gap-2 font-mono text-2xs text-text-4 min-w-0 truncate">
          <span aria-hidden className="h-3 w-px bg-border" />
          {facts.map((f, i) => (
            <span key={f} className="flex items-center gap-2 truncate">
              {i > 0 && <span aria-hidden className="text-text-4/40">·</span>}
              {f}
            </span>
          ))}
        </span>
      )}

      {/* An idle-unloaded chassis is a healthy runtime resting, not a fault —
          it reloads on the next message, so it reads as state, not error. */}
      {about?.chassis?.loaded === false && (
        <span className="font-mono text-2xs text-text-4 flex-shrink-0" title="The chassis unloaded after an idle timeout — the session and its ledger are intact">
          chassis idle · reloads on next message
        </span>
      )}

      {/* State — the only place hue is allowed up here */}
      {endpoint.status === 'error' && (
        <span className="flex items-center gap-1.5 text-2xs text-danger flex-shrink-0">
          <TriangleAlert size={11} /> {endpoint.error || 'unreachable'}
        </span>
      )}
      {(endpoint.drift?.novel?.length > 0 || endpoint.drift?.missing?.length > 0) && (
        <span
          className="text-2xs text-warning font-mono flex-shrink-0"
          title={`novel: ${endpoint.drift.novel.join(', ') || '—'} · missing: ${endpoint.drift.missing.join(', ') || '—'}`}
        >
          drift +{endpoint.drift.novel.length}/−{endpoint.drift.missing.length}
        </span>
      )}
      {anomalies?.length > 0 && (
        <span
          className="flex items-center gap-1 text-2xs text-warning flex-shrink-0"
          title={anomalies.slice(-3).map((a) => `${a.eventId}: ${a.message}`).join('\n')}
        >
          <TriangleAlert size={11} /> {anomalies.length} contract {anomalies.length === 1 ? 'anomaly' : 'anomalies'}
        </span>
      )}

      <div className="ml-auto flex items-center gap-1 flex-shrink-0">
        <button
          onClick={onToggleTicker}
          className={cn(
            'flex items-center gap-1.5 h-7 px-2 rounded-md text-2xs font-medium transition-colors cursor-pointer',
            tickerOpen ? 'bg-surface-3 text-text-1' : 'text-text-4 hover:text-text-1 hover:bg-surface-2',
          )}
          title="Raw event stream — the ground truth behind every line above"
        >
          <Radio size={12} />
          Ground truth
          <span className="font-mono text-text-4">{eventCount}</span>
        </button>
        {onSetup && (
          <button
            onClick={onSetup}
            className={cn(
              'flex items-center gap-1.5 h-7 px-2 rounded-md text-2xs font-medium transition-colors cursor-pointer',
              endpoint.status === 'error'
                ? 'text-danger hover:bg-danger/10'
                : 'text-text-4 hover:text-text-1 hover:bg-surface-2',
            )}
            title="Change endpoint or set up a runtime"
          >
            <Settings2 size={12} />
            {endpoint.status === 'error' ? 'Fix connection' : 'Setup'}
          </button>
        )}
        <RuntimeLifecycle endpoint={endpoint} />
      </div>
    </div>
  );
}

// ── Sessions — a tab strip, not a sidebar ──────────────────────────────────

function SessionTabs({ endpoint }) {
  const axomSelected = useGrooveStore((s) => s.axomSelected);
  const selectAxomSession = useGrooveStore((s) => s.selectAxomSession);
  if (endpoint.sessions.length === 0) return null;
  return (
    <div className="flex-shrink-0 h-8 border-b border-border-subtle bg-surface-1 px-2 flex items-center gap-1 overflow-x-auto">
      {endpoint.sessions.map((s) => {
        const active = axomSelected?.session === s.session;
        return (
          <button
            key={s.session}
            onClick={() => selectAxomSession(endpoint.name, s.session)}
            className={cn(
              'flex items-center gap-1.5 h-6 px-2 rounded font-mono text-2xs whitespace-nowrap transition-colors cursor-pointer',
              active ? 'bg-surface-3 text-text-0' : 'text-text-4 hover:text-text-2 hover:bg-surface-2',
            )}
            title={s.overflow > 0 ? `${s.overflow} events evicted from the buffer` : undefined}
          >
            <StatusDot status={s.live ? 'running' : 'completed'} size="sm" />
            {s.session}
            {s.overflow > 0 && <span className="text-warning">−{s.overflow}</span>}
          </button>
        );
      })}
      {/* §12: session ids are caller-chosen; the first message creates it */}
      <button
        onClick={() => selectAxomSession(endpoint.name, `s-${Math.random().toString(36).slice(2, 10)}`)}
        className="h-6 w-6 flex items-center justify-center rounded text-text-4 hover:text-text-1 hover:bg-surface-2 transition-colors cursor-pointer flex-shrink-0"
        title="New session — created on your first message"
      >
        <Plus size={12} />
      </button>
    </div>
  );
}

// ── Local instance controls (drawer footer) ────────────────────────────────

function InstanceControls() {
  const instances = useGrooveStore((s) => s.axomInstances);
  const startAxomInstance = useGrooveStore((s) => s.startAxomInstance);
  const stopAxomInstance = useGrooveStore((s) => s.stopAxomInstance);
  const addToast = useGrooveStore((s) => s.addToast);
  if (instances.length === 0) return null;
  return (
    <div className="flex-shrink-0 border-t border-border-subtle px-3 py-2 flex flex-col gap-1">
      <div className="text-2xs uppercase tracking-[0.12em] text-text-4 font-semibold">Local instances</div>
      {instances.map((inst) => (
        <div key={inst.id} className="flex items-center gap-2 text-2xs text-text-3">
          <StatusDot status={inst.status === 'running' ? 'running' : inst.status === 'error' ? 'crashed' : 'completed'} size="sm" />
          <span className="font-mono truncate" title={inst.error || inst.dataDir}>{inst.id}:{inst.port}</span>
          <button
            onClick={() => (inst.status === 'running'
              ? stopAxomInstance(inst.id)
              : startAxomInstance(inst.id)
            ).catch((err) => addToast('error', 'Instance action failed', err.message))}
            className="ml-auto text-text-4 hover:text-text-1 cursor-pointer transition-colors"
            title={inst.status === 'running' ? 'Stop instance' : 'Start instance'}
          >
            {inst.status === 'running' ? <Square size={11} /> : <Play size={11} />}
          </button>
        </div>
      ))}
    </div>
  );
}

// ── Raw ticker — every envelope, verbatim, nothing dropped ─────────────────
//
// Demoted from a permanent pane to a drawer: ground truth on demand. Kinds
// are scannable by WEIGHT and CASE, not by hue — only genuine state kinds
// (stop, anomaly-adjacent) carry color.

const KIND_EMPHASIS = {
  narration: 'text-text-1 font-medium',
  resolution: 'text-text-0 font-medium',
  text: 'text-text-1',
  thought: 'text-text-2',
  interrupt: 'text-text-0 font-medium', interrupt_ack: 'text-text-2',
  stop_requested: 'text-danger', stop_effected: 'text-danger',
  leaf_swap: 'text-text-1',
};

function payloadPreview(payload) {
  if (payload == null) return '';
  if (typeof payload === 'string') return payload;
  const text = payload.text || payload.thought || payload.content;
  if (typeof text === 'string') return text;
  try { return JSON.stringify(payload); } catch { return String(payload); }
}

function RawTicker({ events, highlight, onClose }) {
  const scrollRef = useRef(null);
  const pinnedRef = useRef(true);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && pinnedRef.current && !highlight) el.scrollTop = el.scrollHeight;
  }, [events.length, highlight]);

  // Provenance interaction: when a narration is selected, bring its first
  // cited event into view — trust becomes tactile.
  useEffect(() => {
    if (!highlight?.ids?.length) return;
    const container = scrollRef.current;
    const el = container?.querySelector(`[data-ev="${highlight.ids[0]}"]`);
    if (!el) return;
    // NEVER scrollIntoView here: it scrolls every ancestor scroll container,
    // which drags the whole app sideways on wide rows and strands the user
    // with no way back. Scroll this pane, and only this pane.
    container.scrollTo({
      top: el.offsetTop - (container.clientHeight / 2) + (el.offsetHeight / 2),
      behavior: 'smooth',
    });
  }, [highlight]);

  function onScroll() {
    const el = scrollRef.current;
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  }

  const cited = new Set(highlight?.ids || []);

  return (
    <div className="w-[24rem] xl:w-[28rem] flex-shrink-0 border-l border-border-subtle bg-surface-1 flex flex-col min-h-0">
      <div className="flex-shrink-0 h-8 px-3 flex items-center gap-2 border-b border-border-subtle">
        <Radio size={11} className="text-text-4" />
        <span className="text-2xs uppercase tracking-[0.12em] text-text-4 font-semibold">Ground truth</span>
        <span className="font-mono text-2xs text-text-4">{events.length} buffered</span>
        <button
          onClick={onClose}
          className="ml-auto h-6 w-6 flex items-center justify-center rounded text-text-4 hover:text-text-1 hover:bg-surface-2 transition-colors cursor-pointer"
          title="Close"
        >
          <X size={12} />
        </button>
      </div>
      <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto px-2 py-1.5 font-mono text-2xs leading-5">
        {events.length === 0 && (
          <p className="px-1 text-text-4 font-sans text-xs">Waiting for events…</p>
        )}
        {events.map((e) => (
          <div
            key={e.id}
            data-ev={e.id}
            className={cn(
              'flex gap-2 items-baseline rounded px-1 transition-colors',
              cited.has(e.id) ? 'bg-accent/10 text-text-1 ring-1 ring-accent/30' : 'hover:bg-surface-2',
            )}
          >
            <span className="text-text-4/70 flex-shrink-0">{e.id}</span>
            <span className={cn('flex-shrink-0', KIND_EMPHASIS[e.kind] || 'text-text-3')}>{e.kind}</span>
            {e.step != null && <span className="text-text-4/70 flex-shrink-0">s{e.step}</span>}
            <span className="text-text-4 truncate">{payloadPreview(e.payload)}</span>
          </div>
        ))}
      </div>
      <InstanceControls />
    </div>
  );
}

// ── Conversation model — events folded into turns ──────────────────────────
//
// The stream is a transcript, not a log dump. Lifecycle kinds
// (pipeline/firing/step boundaries) are structure: they open and close turns
// rather than earning rows of their own. Everything rendered still traces to
// an event id — nothing here is synthesized.

// §9: narration.payload = {text, cites: [ev-ids]} — `cites` is the field,
// no variant exists.
function narrationCites(payload) {
  const cites = payload?.cites;
  return Array.isArray(cites) ? cites.filter((c) => typeof c === 'string') : [];
}

// §9: leaf_swap.payload = {from: str|null, to: str, firing_id} — the worn
// leaf is `to` (`from` is null on a firing's first swap).
function leafOf(payload) {
  return typeof payload?.to === 'string' ? payload.to : null;
}

function promptOf(payload) {
  for (const k of ['text', 'prompt', 'message', 'query', 'input']) {
    if (typeof payload?.[k] === 'string' && payload[k].trim()) return payload[k];
  }
  return null;
}

// tool_start/tool_end payloads name a tool; the argument is whatever string
// the runtime put there. No shape is invented — an unnamed tool stays "tool".
function toolLabel(payload, kind) {
  const name = payload?.tool || payload?.name || payload?.tool_name;
  let arg = payload?.arg ?? payload?.args ?? payload?.input ?? payload?.query;
  if (arg && typeof arg === 'object') {
    arg = Object.values(arg).find((v) => typeof v === 'string' && v.length < 120);
  }
  const verb = kind === 'tool_end' ? 'finished' : 'running';
  if (!name) return payloadPreview(payload) || verb;
  return [`${verb} ${name}`, typeof arg === 'string' ? arg : null].filter(Boolean).join(' · ');
}

const LIFECYCLE = new Set(['firing_start', 'firing_end', 'step_start', 'step_end']);

// How long a prompt may sit unattached before the transcript stops implying
// a turn is on its way for it.
const PROMPT_STALE_S = 25;

function buildTurns(events) {
  const turns = [];
  let turn = null;

  function current(seedId) {
    if (!turn) {
      turn = { id: seedId, prompt: null, promptId: null, blocks: [], done: false, stopped: false };
      turns.push(turn);
    }
    return turn;
  }
  function push(block) { current(block.id).blocks.push(block); }
  function last(type) {
    const b = turn?.blocks[turn.blocks.length - 1];
    return b && b.type === type ? b : null;
  }

  for (const e of events) {
    const p = e.payload || {};
    switch (e.kind) {
      case 'pipeline_start':
        turn = { id: e.id, prompt: promptOf(p), promptId: e.id, blocks: [], done: false, stopped: false };
        turns.push(turn);
        break;

      case 'thought': {
        const text = payloadPreview(p);
        if (!text) break;
        const prev = last('thought');
        if (prev) prev.items.push({ id: e.id, text });
        else push({ type: 'thought', id: e.id, items: [{ id: e.id, text }] });
        break;
      }

      case 'tool_start':
      case 'tool_end': {
        const entry = { id: e.id, text: toolLabel(p, e.kind), done: e.kind === 'tool_end' };
        const prev = last('activity');
        if (prev) prev.items.push(entry);
        else push({ type: 'activity', id: e.id, items: [entry] });
        break;
      }

      case 'narration': {
        // Law 1: an uncited narration renders nothing.
        const cites = narrationCites(p);
        if (!cites.length) break;
        push({ type: 'narration', id: e.id, text: payloadPreview(p), cites });
        break;
      }

      // `text` arrives as line-sized fragments of the answer being written.
      // They are joined with a space (never glued — "searches"+"the web"
      // must not become "searchesthe web") and never mixed with resolution.
      case 'text': {
        const chunk = payloadPreview(p);
        if (!chunk) break;
        const prev = last('answer');
        if (prev && !prev.final) {
          const joiner = /\s$/.test(prev.text) || /^\s/.test(chunk) ? '' : ' ';
          if (!prev.text.endsWith(chunk)) prev.text += joiner + chunk;
          prev.ids.push(e.id);
        } else {
          push({ type: 'answer', id: e.id, text: chunk, final: false, ids: [e.id] });
        }
        break;
      }

      // A resolution is the settled answer in its own right — authoritative
      // and complete. It gets its own block rather than being appended to the
      // streamed fragments, so neither text is distorted by the other.
      case 'resolution': {
        const chunk = payloadPreview(p);
        if (!chunk) break;
        push({ type: 'answer', id: e.id, text: chunk, final: true, ids: [e.id] });
        break;
      }

      case 'leaf_swap':
        push({ type: 'leaf', id: e.id, leaf: leafOf(p) ?? 'UNKNOWN' });
        break;

      case 'interrupt':
        // `id` is the envelope; `steerId` is the interrupt's own id, which is
        // what an ack names (§8). Both are kept so the ack can find its steer.
        push({
          type: 'steer', id: e.id, steerId: p.interrupt_id ?? p.id ?? null,
          text: payloadPreview(p), acked: false,
        });
        break;

      case 'interrupt_ack': {
        // The ack lands on the steer it names; §8 pins interrupt_id present.
        // With no id, the oldest unacked steer is the only honest guess — and
        // the slice already logs that shape violation as an anomaly.
        const target = p.interrupt_id ?? p.id ?? null;
        for (let i = turns.length - 1; i >= 0; i--) {
          const hit = turns[i].blocks.find((b) => b.type === 'steer' && !b.acked
            && (target ? b.steerId === target || b.id === target : true));
          if (hit) { hit.acked = true; break; }
        }
        break;
      }

      case 'stop_requested':
        push({ type: 'note', id: e.id, text: 'stop requested', state: 'stop' });
        break;
      case 'stop_effected':
        push({ type: 'note', id: e.id, text: 'stopped', state: 'stop' });
        break;

      case 'pipeline_done':
        if (turn) { turn.done = true; turn.stopped = p.stopped_early === true; }
        turn = null;
        break;

      default:
        if (LIFECYCLE.has(e.kind)) break; // structure, not a row
        break;
    }
  }
  return turns;
}

// ── Conversation rendering — the fleet chat's vocabulary ───────────────────

function UserTurn({ text, status }) {
  return (
    <div className="flex justify-end pl-8">
      <div className="max-w-[85%] flex flex-col items-end gap-1">
        <div className="px-3.5 py-2.5 rounded-lg border border-accent/20 bg-accent/[0.07]">
          <div className="text-[12px] font-sans whitespace-pre-wrap break-words leading-relaxed text-text-0">
            {text}
          </div>
        </div>
        {status && (
          <span className={cn('font-mono text-2xs', status.stale ? 'text-warning' : 'text-text-4')}>
            {status.label}
          </span>
        )}
      </div>
    </div>
  );
}

// A steer is a user utterance too, but mid-flight — and its state is only
// ever what the stream said (heard on `interrupt`, acked on `interrupt_ack`).
function SteerLine({ block }) {
  return (
    <div className="flex justify-end pl-8">
      <div className="max-w-[85%] flex flex-col items-end gap-1">
        <div className="px-3 py-1.5 rounded-lg border border-border bg-surface-2">
          <span className="flex items-center gap-1.5 text-[12px] font-sans text-text-1 leading-relaxed">
            <Zap size={11} className="text-accent flex-shrink-0" />
            {block.text}
          </span>
        </div>
        <span className="font-mono text-2xs text-text-4">
          {block.acked ? 'acked' : 'heard'} · {block.id}
        </span>
      </div>
    </div>
  );
}

function ThoughtBlock({ block }) {
  const [open, setOpen] = useState(false);
  const shown = open ? block.items : block.items.slice(-1);
  return (
    <div className="flex flex-col gap-1">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-2xs text-text-4 hover:text-text-2 font-sans transition-colors cursor-pointer w-fit"
      >
        <Brain size={11} />
        {block.items.length === 1 ? 'thought' : `${block.items.length} thoughts`}
        {block.items.length > 1 && <ChevronDown size={10} className={cn('transition-transform', open && 'rotate-180')} />}
      </button>
      <div className="pl-3.5 border-l border-border flex flex-col gap-1">
        {shown.map((t) => (
          <p key={t.id} className="text-[11px] font-sans text-text-3 leading-relaxed italic">{t.text}</p>
        ))}
      </div>
    </div>
  );
}

// Tool activity, fleet-style: a live group cycles its entries behind a
// spinner; a settled group collapses to a count you can open.
function ActivityBlock({ block, live }) {
  const [open, setOpen] = useState(false);
  const [cycle, setCycle] = useState(0);
  const items = block.items;
  const isLive = live && !items[items.length - 1]?.done;

  useEffect(() => {
    if (!isLive || items.length <= 1) return;
    const t = setInterval(() => setCycle((i) => (i + 1) % items.length), 1500);
    return () => clearInterval(t);
  }, [isLive, items.length]);

  if (isLive) {
    const cur = items[Math.min(cycle, items.length - 1)];
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-surface-2 border border-border-subtle">
        <Loader2 size={11} className="text-accent animate-spin flex-shrink-0" />
        <span className="text-[11px] text-text-2 font-mono truncate min-w-0 flex-1">{cur.text}</span>
        {items.length > 1 && <span className="text-2xs text-text-4 font-mono flex-shrink-0">{items.length}</span>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 text-2xs text-text-4 hover:text-text-2 font-mono transition-colors cursor-pointer w-fit"
      >
        <Wrench size={10} />
        {items.length} tool call{items.length === 1 ? '' : 's'}
        <ChevronDown size={10} className={cn('transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="pl-3.5 border-l border-border flex flex-col">
          {items.map((it) => (
            <div key={it.id} className="flex items-center gap-2 py-0.5">
              <Wrench size={9} className="text-text-4 flex-shrink-0" />
              <span className="text-[11px] text-text-3 font-mono truncate flex-1 min-w-0">{it.text}</span>
              <span className="text-2xs text-text-4 font-mono flex-shrink-0">{it.id}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Narration keeps its provenance interaction — but as an inline expansion,
// not a second column. Clicking reveals the cited envelopes right here and
// mirrors the selection into the ground-truth drawer if it's open.
function NarrationBlock({ block, eventsById, highlight, onHighlight }) {
  const active = highlight?.narrationId === block.id;
  return (
    <div className="flex flex-col gap-1">
      <button
        onClick={() => onHighlight(active ? null : { narrationId: block.id, ids: block.cites })}
        className={cn(
          'group flex items-start gap-2 text-left rounded-md px-2 py-1 -mx-2 transition-colors cursor-pointer',
          active ? 'bg-surface-2' : 'hover:bg-surface-2/60',
        )}
        title="Show the events behind this line"
      >
        <MessageSquareQuote size={12} className={cn('mt-0.5 flex-shrink-0', active ? 'text-accent' : 'text-text-4')} />
        <span className="text-[12px] font-sans text-text-2 leading-relaxed">{block.text}</span>
        <span className={cn(
          'ml-auto flex-shrink-0 font-mono text-2xs transition-colors',
          active ? 'text-accent' : 'text-text-4 opacity-0 group-hover:opacity-100',
        )}>
          {block.cites.length} cited
        </span>
      </button>
      {active && (
        <div className="ml-5 rounded-md border border-border-subtle bg-surface-0 px-2 py-1.5 font-mono text-2xs leading-5">
          {block.cites.map((id) => {
            const ev = eventsById[id];
            return (
              <div key={id} className="flex gap-2 items-baseline">
                <span className="text-text-4/70 flex-shrink-0">{id}</span>
                <span className={cn('flex-shrink-0', ev ? KIND_EMPHASIS[ev.kind] || 'text-text-3' : 'text-warning')}>
                  {ev ? ev.kind : 'evicted from buffer'}
                </span>
                <span className="text-text-4 truncate">{ev ? payloadPreview(ev.payload) : ''}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function AnswerBlock({ block, family }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <span className="text-2xs font-semibold text-text-1 font-sans">Axom</span>
        {family && <span className="text-2xs text-text-4 font-mono">{family}</span>}
        <span className="text-2xs text-text-4 font-mono">{block.final ? 'resolution' : 'text'}</span>
        <span className="ml-auto font-mono text-2xs text-text-4">{block.ids[0]}</span>
      </div>
      <div className="pl-3.5 border-l border-accent">
        <StructuredMessage text={block.text} />
      </div>
    </div>
  );
}

function Divider({ icon: Icon, text, tone }) {
  return (
    <div className="flex items-center gap-3 py-1">
      <div className="flex-1 h-px bg-border-subtle" />
      <span className={cn('flex items-center gap-1.5 text-2xs font-sans uppercase tracking-[0.1em] flex-shrink-0', tone || 'text-text-4')}>
        {Icon && <Icon size={10} />} {text}
      </span>
      <div className="flex-1 h-px bg-border-subtle" />
    </div>
  );
}

function TurnView({ turn, live, family, eventsById, highlight, onHighlight, prompt, ambiguous }) {
  // A turn with no prompt of ours shows NO bubble — a one-sided transcript
  // that's honest beats a complete one that's invented. But the two reasons
  // it can happen are different claims, and the label must not overreach:
  //   · nothing of ours is pending → another client genuinely started it.
  //   · something of ours IS pending → the slice declined an ambiguous
  //     attachment, so we know a prompt exists and can't say which. Saying
  //     "started elsewhere" there would assert something we can't back.
  const unclaimed = !prompt && !!turn.promptId;
  return (
    <div className="flex flex-col gap-3">
      {prompt && <UserTurn text={prompt} />}
      {unclaimed && <Divider text={ambiguous ? 'prompt not identified' : 'started elsewhere'} />}
      {turn.blocks.map((b) => {
        switch (b.type) {
          case 'thought': return <ThoughtBlock key={b.id} block={b} />;
          case 'activity': return <ActivityBlock key={b.id} block={b} live={live} />;
          case 'narration': return (
            <NarrationBlock key={b.id} block={b} eventsById={eventsById} highlight={highlight} onHighlight={onHighlight} />
          );
          case 'answer': return <AnswerBlock key={b.id} block={b} family={family} />;
          case 'steer': return <SteerLine key={b.id} block={b} />;
          case 'leaf': return <Divider key={b.id} icon={Shirt} text={`wearing ${b.leaf}`} />;
          case 'note': return <Divider key={b.id} icon={OctagonX} text={b.text} tone="text-danger" />;
          default: return null;
        }
      })}
      {turn.stopped && <Divider icon={OctagonX} text="stopped early" tone="text-danger" />}
    </div>
  );
}

function Conversation({ events, prompts, sessionLive, family, highlight, onHighlight }) {
  const scrollRef = useRef(null);
  const pinnedRef = useRef(true);
  const turns = useMemo(() => buildTurns(events), [events]);
  const eventsById = useMemo(() => Object.fromEntries(events.map((e) => [e.id, e])), [events]);

  useEffect(() => {
    const el = scrollRef.current;
    // Scoped to this pane only — never scrollIntoView (see RawTicker).
    if (el && pinnedRef.current) el.scrollTop = el.scrollHeight;
  }, [events.length]);

  function onScroll() {
    const el = scrollRef.current;
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  }

  // Pending prompts age on their own clock — the stream may go quiet, and a
  // "still awaiting" label that can never update is its own small deception.
  const pending = prompts.filter((p) => !p.attachedTo);
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    if (!pending.length) return;
    const t = setInterval(() => setNow(Date.now() / 1000), 3000);
    return () => clearInterval(t);
  }, [pending.length]);

  const lastTurn = turns[turns.length - 1];
  const lastBlock = lastTurn?.blocks[lastTurn.blocks.length - 1];
  const awaiting = sessionLive && lastTurn && !lastTurn.done
    && (!lastBlock || (lastBlock.type !== 'activity' && lastBlock.type !== 'answer'));

  return (
    <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto min-h-0">
      <div className="max-w-3xl mx-auto w-full px-5 py-5 flex flex-col gap-6">
        {turns.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-16 text-center">
            <Atom size={28} strokeWidth={1} className="text-text-4" />
            <p className="text-xs text-text-3 max-w-sm leading-relaxed">
              Nothing has happened in this session yet. Send a message below — every
              step Axom takes will appear here, and every line will cite the events
              behind it.
            </p>
          </div>
        )}
        {turns.map((t, i) => (
          <TurnView
            key={t.id}
            turn={t}
            // §prompt ledger: a turn's prompt is the entry the slice attached
            // to that turn's pipeline_start envelope — a stable key, never a
            // timestamp guess. Rejected prompts (409/413) never got an entry.
            prompt={t.prompt || prompts.find((p) => p.attachedTo && p.attachedTo === t.promptId)?.text || null}
            ambiguous={pending.length > 0}
            live={sessionLive && i === turns.length - 1 && !t.done}
            family={family}
            eventsById={eventsById}
            highlight={highlight}
            onHighlight={onHighlight}
          />
        ))}
        {/* Accepted (202) but no pipeline_start yet — the runtime took it and
            hasn't opened the turn. Shown so a sent message never vanishes,
            and aged: a bubble that sits here forever quietly implies "still
            working" when the truth is that no turn ever opened for it. */}
        {pending.map((p) => (
          <UserTurn
            key={p.ts}
            text={p.text}
            status={now - p.ts > PROMPT_STALE_S
              ? { label: 'sent · no turn opened for it', stale: true }
              : { label: 'sent · awaiting turn' }}
          />
        ))}
        {awaiting && <ThinkingIndicator agent={{ name: 'Axom' }} />}
      </div>
    </div>
  );
}

// ── Wardrobe — the worn leaf, never guessed ────────────────────────────────

function WardrobeStrip({ about, events }) {
  const swaps = useMemo(
    () => events.filter((e) => e.kind === 'leaf_swap').map((e) => ({ id: e.id, leaf: leafOf(e.payload) })),
    [events],
  );
  const roster = about?.leaves || [];
  // UNKNOWN is the default render — a HUD that guesses is a fail-open in a
  // costume. Only a leaf_swap event names the worn leaf.
  const current = swaps.length ? (swaps[swaps.length - 1].leaf ?? 'UNKNOWN') : 'UNKNOWN';

  return (
    <div className="flex-shrink-0 h-7 border-b border-border-subtle px-3 flex items-center gap-2 overflow-x-auto">
      <Shirt size={11} className="text-text-4 flex-shrink-0" />
      <span className="font-mono text-2xs flex-shrink-0">
        <span className={current === 'UNKNOWN' ? 'text-text-4' : 'text-text-1'}>{current}</span>
      </span>
      {swaps.length > 1 && (
        <span className="font-mono text-2xs text-text-4 whitespace-nowrap" title="Leaf swap history — each entry is a leaf_swap event">
          ← {swaps.slice(-6, -1).reverse().map((s) => s.leaf ?? '?').join(' ← ')}
        </span>
      )}
      <span className="ml-auto font-mono text-2xs text-text-4 whitespace-nowrap flex-shrink-0">
        roster {roster.length ? roster.map((l) => l.name).join(' · ') : '—'}
      </span>
    </div>
  );
}

// ── Living Answer (M4) — the tournament, spectated ─────────────────────────
//
// Payload shapes ratified from runtime source in contract §10 (234537e):
// candidates are identified by firing_id; derived events carry `basis`
// (ev-id provenance — same click-to-highlight as narration); the verifier
// slot is null until runtime verifier integration and renders dimmed-absent;
// verifier_verdict is reserved-dark and deliberately NOT parsed. The panel
// appears only when a consensus run exists — no tournament, no panel.
// Watermark machine (kinds + §8 stopped_early) ratified as GUI derivation.

function livingAnswer(events) {
  let state = null;
  const blank = () => ({
    watermark: 'PROVISIONAL', candidates: [], byFiring: {},
    champion: null, confidence: null, evidence: [], banked: 0,
  });
  for (const e of events) {
    const p = e.payload || {};
    if (e.kind === 'pipeline_start') state = null; // new run, fresh tournament
    else if (e.kind === 'candidate_arrived') {
      state = state || blank();
      const c = {
        firingId: p.firing_id, leafId: p.leaf_id, text: p.text,
        banked: !!p.banked, basis: Array.isArray(p.basis) ? p.basis : [],
      };
      state.candidates.push(c);
      if (c.firingId) state.byFiring[c.firingId] = c;
    } else if (state && e.kind === 'champion_changed') {
      state.champion = {
        to: p.to, from: p.from ?? null, rule: p.rule,
        basis: Array.isArray(p.basis) ? p.basis : [],
      };
    } else if (state && e.kind === 'confidence_updated') {
      state.confidence = p;
    } else if (state && e.kind === 'evidence_scored') {
      state.evidence.push({ source: p.source, values: p.values, basis: Array.isArray(p.basis) ? p.basis : [] });
    } else if (state && e.kind === 'candidate_banked') {
      state.banked += 1;
    } else if (state && e.kind === 'pipeline_done') {
      state.watermark = p.stopped_early === true ? 'STOPPED' : 'SETTLED';
    }
  }
  return state;
}

// Watermark is real state, so it may carry hue — but only the watermark.
const WATERMARK_TONE = {
  PROVISIONAL: 'text-warning',
  SETTLED: 'text-text-1',
  STOPPED: 'text-danger',
};

// A provenance-bearing block: clicking highlights its basis events, exactly
// like narration cites.
function BasisButton({ basis, highlightKey, highlight, onHighlight, className, children, title }) {
  const active = highlight?.narrationId === highlightKey;
  return (
    <button
      title={title}
      onClick={() => basis.length && onHighlight(active ? null : { narrationId: highlightKey, ids: basis })}
      className={cn(
        'text-left rounded transition-colors',
        basis.length ? 'cursor-pointer' : 'cursor-default',
        active ? 'bg-surface-3' : 'hover:bg-surface-2',
        className,
      )}
    >
      {children}
    </button>
  );
}

function LivingAnswerPanel({ answer, onStop, stopState, highlight, onHighlight }) {
  const [open, setOpen] = useState(false);
  const champion = answer.champion ? answer.byFiring[answer.champion.to] : null;
  const conf = answer.confidence;
  const live = answer.watermark === 'PROVISIONAL';

  return (
    <div className="flex-shrink-0 border-t border-border-subtle bg-surface-1">
      <div className="max-w-3xl mx-auto w-full px-5">
        <div className="h-8 flex items-center gap-2.5">
          <Trophy size={11} className="text-text-4 flex-shrink-0" />
          <span className="text-2xs uppercase tracking-[0.12em] text-text-4 font-semibold flex-shrink-0">Living answer</span>
          <span className={cn('font-mono text-2xs font-semibold flex-shrink-0', WATERMARK_TONE[answer.watermark])}>
            {answer.watermark}
          </span>
          <span className="font-mono text-2xs text-text-4 truncate">
            {answer.candidates.length} candidate{answer.candidates.length === 1 ? '' : 's'}
            {answer.banked > 0 && ` · ${answer.banked} banked`}
          </span>
          {live && (
            <button
              onClick={onStop}
              disabled={stopState === 'pending'}
              className="flex items-center gap-1.5 h-6 px-2 rounded text-2xs font-medium text-text-3 hover:text-danger hover:bg-danger/10 disabled:opacity-40 disabled:pointer-events-none transition-colors cursor-pointer flex-shrink-0"
              title="Settle the tournament on the current champion"
            >
              <OctagonX size={11} /> Good enough
            </button>
          )}
          <button
            onClick={() => setOpen((v) => !v)}
            className="ml-auto h-6 w-6 flex items-center justify-center rounded text-text-4 hover:text-text-1 hover:bg-surface-2 transition-colors cursor-pointer flex-shrink-0"
            title={open ? 'Collapse' : 'Show champion and confidence'}
          >
            <ChevronDown size={12} className={cn('transition-transform', open && 'rotate-180')} />
          </button>
        </div>

        {open && (
          <div className="pb-2 flex flex-col gap-1.5 max-h-48 overflow-y-auto">
            {answer.champion && (
              <BasisButton
                basis={answer.champion.basis}
                highlightKey="champion"
                highlight={highlight}
                onHighlight={onHighlight}
                className="px-2 py-1.5 border border-border-subtle"
                title={answer.champion.basis.length ? 'Click to highlight the events behind this champion' : undefined}
              >
                <span className="flex items-center gap-2 mb-0.5 font-mono text-2xs text-text-4">
                  {champion?.leafId && <span className="text-text-2">{champion.leafId}</span>}
                  {answer.champion.rule && <span>rule {answer.champion.rule}</span>}
                </span>
                {typeof champion?.text === 'string' && (
                  <span className="block text-[12px] text-text-2 leading-relaxed whitespace-pre-wrap">
                    {champion.text.length > 400 ? `${champion.text.slice(0, 400)}…` : champion.text}
                  </span>
                )}
              </BasisButton>
            )}

            {conf && (
              <BasisButton
                basis={Array.isArray(conf.basis) ? conf.basis : []}
                highlightKey="confidence"
                highlight={highlight}
                onHighlight={onHighlight}
                className="px-2 py-1 font-mono text-2xs text-text-4"
              >
                {[
                  conf.candidates != null && `${conf.candidates} candidates`,
                  conf.n_fused != null && conf.n_agents != null && `${conf.n_fused}/${conf.n_agents} fused`,
                  conf.n_facts != null && `${conf.n_facts} facts`,
                  conf.tools_grounded != null && `tools ${String(conf.tools_grounded)}`,
                ].filter(Boolean).join(' · ')}
                {/* §10: the U3 meter waiting for its organ — dimmed, never invented */}
                <span className="opacity-60"> · verifier: {conf.verifier == null ? 'awaiting integration' : String(conf.verifier)}</span>
              </BasisButton>
            )}

            {answer.evidence.length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap">
                {answer.evidence.slice(-3).map((ev, i) => (
                  <BasisButton
                    key={`${ev.source}-${i}`}
                    basis={ev.basis}
                    highlightKey={`evidence-${answer.evidence.length - 3 + i}`}
                    highlight={highlight}
                    onHighlight={onHighlight}
                    className="px-1.5 py-0.5 border border-border-subtle font-mono text-2xs text-text-4"
                    title={ev.values ? JSON.stringify(ev.values) : undefined}
                  >
                    {ev.source ?? 'evidence'}
                  </BasisButton>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Hot input + interrupt/stop accountability ──────────────────────────────

const STOP_LABEL = {
  pending: 'stop pending…',
  effected: 'stopped',
  'resolved-before-stop': 'resolved before stop',
};

// §7: the three-state rollup from pipeline_done — "nothing you type silently
// vanishes" deserves pixels. Shape pinned by contract §8 (nested-only):
// pipeline_done.payload.interrupts.{acked, unanswered, unconsumed}, three
// flat lists of interrupt-id strings. Rendered only when present (fail-open).
function interruptRollup(events) {
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].kind !== 'pipeline_done') continue;
    const src = events[i].payload?.interrupts;
    if (!src || typeof src !== 'object') return null;
    const states = ['acked', 'unanswered', 'unconsumed'].filter((k) => Array.isArray(src[k]));
    if (states.length === 0) return null;
    return Object.fromEntries(states.map((k) => [k, src[k].length]));
  }
  return null;
}

function HotInput({ sessionLive, rollup }) {
  const axomSelected = useGrooveStore((s) => s.axomSelected);
  const interrupts = useGrooveStore((s) => s.axomInterrupts);
  const stops = useGrooveStore((s) => s.axomStops);
  const sendAxomInterrupt = useGrooveStore((s) => s.sendAxomInterrupt);
  const sendAxomMessage = useGrooveStore((s) => s.sendAxomMessage);
  const sendAxomStop = useGrooveStore((s) => s.sendAxomStop);
  const addToast = useGrooveStore((s) => s.addToast);
  const [text, setText] = useState('');

  const key = axomSelected ? axomSessionKey(axomSelected.endpoint, axomSelected.session) : null;
  const ledger = (key && interrupts[key]) || {};
  const stopState = (key && stops[key]) || null;

  // §12 two-verb split: message starts a turn (session idle), interrupt
  // steers one already in flight. The verbs stay distinct — on a stale-`live`
  // 409 we report, never silently reroute a prompt into a steer.
  async function send() {
    const message = text.trim();
    if (!message) return;
    setText(''); // input never locks — clear immediately, chips carry the truth
    try {
      if (sessionLive) {
        const result = await sendAxomInterrupt(message);
        if (result.truncated) addToast('warning', 'Interrupt truncated', 'The runtime capped it at 2000 chars');
      } else {
        const result = await sendAxomMessage(message);
        if (result.busy) {
          addToast('warning', 'Turn already in flight', 'Not sent — type again to steer the running turn instead');
          setText(message);
        } else if (result.tooLong) {
          addToast('error', 'Message too long', `The runtime's max is ${result.max || 32768} chars — nothing was truncated`);
          setText(message);
        }
      }
    } catch (err) {
      // 503 is not 409: the runtime is shutting down, so retrying can never
      // succeed. It must not read as "busy, try again".
      if (err.status === 503) {
        addToast('error', 'This runtime is shutting down', 'Nothing was sent — that endpoint is going away.');
      } else {
        addToast('error', sessionLive ? 'Interrupt failed' : 'Message failed', err.message);
      }
      setText(message);
    }
  }

  async function stop() {
    try { await sendAxomStop(); } catch (err) { addToast('error', 'Stop failed', err.message); }
  }

  // Only steers the stream has NOT yet confirmed live here; once the runtime
  // emits `interrupt`, the steer appears in the transcript above and this
  // pending row lets go of it. Nothing is claimed that no event backs.
  const pending = Object.entries(ledger).filter(([, v]) => v.state === 'sent').slice(-3);

  return (
    <div className="flex-shrink-0 border-t border-border-subtle bg-surface-1 px-5 py-2.5">
      <div className="max-w-3xl mx-auto w-full flex flex-col gap-1.5">

        {(pending.length > 0 || stopState || rollup) && (
          <div className="flex items-center gap-2 flex-wrap font-mono text-2xs text-text-4">
            {pending.map(([id, entry]) => (
              <span key={id} title={entry.text} className="max-w-56 truncate">
                sent · {entry.text}
              </span>
            ))}
            {stopState && (
              <span className={cn(stopState === 'effected' || stopState === 'pending' ? 'text-danger' : 'text-text-3')}>
                {STOP_LABEL[stopState]}
              </span>
            )}
            {rollup && (
              <span title="Interrupt accounting from the last pipeline_done rollup — every interrupt ends in exactly one state">
                rollup{' '}
                {Object.entries(rollup).map(([state, count], i) => (
                  <span key={state} className={state === 'unconsumed' && count > 0 ? 'text-warning' : undefined}>
                    {i > 0 && ' · '}{count} {state}
                  </span>
                ))}
              </span>
            )}
          </div>
        )}

        <div className="flex flex-col rounded-lg border border-border-subtle bg-surface-0 transition-colors focus-within:border-text-4/40">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder={sessionLive ? 'Steer Axom mid-flight…' : 'Message your Axom — starts a turn'}
            rows={1}
            className="w-full resize-none field-sizing-content max-h-40 px-3 py-2.5 text-[13px] leading-[20px] bg-transparent font-sans text-text-0 placeholder:text-text-4 focus:outline-none"
          />
          <div className="flex items-center gap-1.5 px-1.5 pb-1.5">
            {sessionLive && (
              <span className="flex items-center gap-2 pl-1.5">
                <span className="relative flex items-center justify-center w-3 h-3">
                  <span className="absolute inset-0 rounded-full bg-accent/30 animate-ping [animation-duration:2s]" />
                  <span className="relative w-1.5 h-1.5 rounded-full bg-accent" />
                </span>
                <span className="text-2xs text-text-4 font-sans">turn in flight</span>
              </span>
            )}
            <div className="flex-1" />
            {sessionLive && (
              <button
                onClick={stop}
                disabled={!axomSelected || stopState === 'pending'}
                className="flex items-center gap-1.5 h-7 px-2 rounded-md text-2xs font-medium text-text-3 hover:text-danger hover:bg-danger/10 disabled:opacity-40 disabled:pointer-events-none transition-colors cursor-pointer"
                title="Stop this turn"
              >
                <OctagonX size={12} /> Stop
              </button>
            )}
            <button
              onClick={send}
              disabled={!axomSelected || !text.trim()}
              className={cn(
                'w-7 h-7 flex items-center justify-center rounded-md transition-colors cursor-pointer',
                'disabled:opacity-15 disabled:cursor-not-allowed',
                text.trim() ? 'text-text-0 hover:text-text-1 hover:bg-surface-3' : 'text-text-4',
              )}
              title={sessionLive ? 'Steer (Enter)' : 'Send (Enter)'}
            >
              {sessionLive ? <Zap size={14} /> : <SendHorizontal size={15} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── View root ───────────────────────────────────────────────────────────────

export default function AxomView() {
  const axomStatus = useGrooveStore((s) => s.axomStatus);
  const axomSelected = useGrooveStore((s) => s.axomSelected);
  const axomEvents = useGrooveStore((s) => s.axomEvents);
  const axomPrompts = useGrooveStore((s) => s.axomPrompts);
  const axomAnomalies = useGrooveStore((s) => s.axomAnomalies);
  const axomStops = useGrooveStore((s) => s.axomStops);
  const selectAxomSession = useGrooveStore((s) => s.selectAxomSession);
  const sendAxomStop = useGrooveStore((s) => s.sendAxomStop);
  const [highlight, setHighlight] = useState(null);
  const [tickerOpen, setTickerOpen] = useState(false);
  // Escape hatch: a configured-but-wrong endpoint must never trap the user in
  // a dead workspace with no way back to setup.
  const [showSetup, setShowSetup] = useState(false);

  const endpoints = axomStatus?.endpoints || [];
  // v0 renders the first endpoint; the config supports several (mesh later).
  const endpoint = endpoints[0];

  // Auto-select the only session so the tab is alive without a click.
  useEffect(() => {
    if (!endpoint || axomSelected) return;
    const live = endpoint.sessions.find((s) => s.live) || endpoint.sessions[0];
    if (live) selectAxomSession(endpoint.name, live.session);
  }, [endpoint, axomSelected, selectAxomSession]);

  const sessionKeyStr = axomSelected ? axomSessionKey(axomSelected.endpoint, axomSelected.session) : null;
  const events = useMemo(
    () => (sessionKeyStr ? axomEvents[sessionKeyStr] || [] : []),
    [sessionKeyStr, axomEvents],
  );

  const prompts = useMemo(
    () => (sessionKeyStr ? axomPrompts[sessionKeyStr] || [] : []),
    [sessionKeyStr, axomPrompts],
  );

  // A highlight belongs to one session's stream — drop it on switch.
  useEffect(() => { setHighlight(null); }, [sessionKeyStr]);

  const answer = useMemo(() => livingAnswer(events), [events]);

  if (!endpoint || showSetup) {
    return <Onboarding onBack={endpoint ? () => setShowSetup(false) : null} />;
  }

  const selectedSession = axomSelected
    && endpoint.sessions.find((s) => s.session === axomSelected.session);
  const sessionLive = !!selectedSession?.live;

  return (
    <div className="h-full flex flex-col bg-surface-1">
      <RuntimeHeader
        endpoint={endpoint}
        anomalies={(sessionKeyStr && axomAnomalies[sessionKeyStr]) || []}
        onSetup={() => setShowSetup(true)}
        tickerOpen={tickerOpen}
        onToggleTicker={() => setTickerOpen((v) => !v)}
        eventCount={events.length}
      />
      <SessionTabs endpoint={endpoint} />
      <div className="flex-1 flex min-h-0">
        <div className="flex-1 flex flex-col min-w-0 min-h-0">
          <WardrobeStrip about={endpoint.about} events={events} />
          <Conversation
            events={events}
            prompts={prompts}
            sessionLive={sessionLive}
            family={endpoint.about?.family}
            highlight={highlight}
            onHighlight={(h) => { setHighlight(h); if (h) setTickerOpen(true); }}
          />
          {answer && (
            <LivingAnswerPanel
              answer={answer}
              onStop={() => sendAxomStop().catch(() => {})}
              stopState={(sessionKeyStr && axomStops[sessionKeyStr]) || null}
              highlight={highlight}
              onHighlight={(h) => { setHighlight(h); if (h) setTickerOpen(true); }}
            />
          )}
          <HotInput sessionLive={sessionLive} rollup={interruptRollup(events)} />
        </div>
        {tickerOpen && (
          <RawTicker events={events} highlight={highlight} onClose={() => setTickerOpen(false)} />
        )}
      </div>
    </div>
  );
}
