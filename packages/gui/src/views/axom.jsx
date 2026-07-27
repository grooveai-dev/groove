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
import { Atom, Zap, OctagonX, Plug, Radio, MessageSquareQuote, Shirt, TriangleAlert, Trophy, Download, Square, Play, Plus, MemoryStick, HardDrive, Cpu, Gauge, CheckCircle2, Globe, Copy, Settings2, Loader2, ChevronDown, SendHorizontal, Wrench, Brain, Power, X, Check, Hourglass, MessageSquare, ChevronRight, Type, Code2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useGrooveStore } from '../stores/groove';
import { axomSessionKey, nextChatLabel } from '../stores/slices/axom-slice';
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

function Onboarding() {
  const addAxomRuntime = useGrooveStore((s) => s.addAxomRuntime);
  const startAxomRuntimeById = useGrooveStore((s) => s.startAxomRuntimeById);
  const startAxomInstall = useGrooveStore((s) => s.startAxomInstall);
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

  // The Spark case: this machine HAS the runtime, so the first-run action is
  // to use it — not to paste a URL pointing at itself. Creates the runtime,
  // activates it, starts it; the workspace takes over from there.
  async function useThisMachine() {
    setSaving(true);
    try {
      const rt = await addAxomRuntime({ name: 'This machine', control: 'local', activate: true });
      await startAxomRuntimeById(rt.id);
    } catch (err) {
      addToast('error', 'Could not start the local runtime', err.message);
    } finally {
      setSaving(false);
    }
  }

  // Connect-only: GROOVE reads this runtime's events and has no lifecycle
  // verbs for it, which is exactly what control:'none' means.
  async function connect() {
    setSaving(true);
    try {
      const parsed = parseEndpoint(url);
      await addAxomRuntime({
        name: parsed?.host || 'Axom',
        control: 'none',
        url: url.trim(),
        activate: true,
      });
    } catch (err) {
      addToast('error', 'Could not add that runtime', err.message);
    } finally {
      setSaving(false);
    }
  }

  function copyText(value) {
    navigator.clipboard.writeText(value);
    addToast('success', 'Copied');
  }

  // What the user is typing, read for the bind trap before they commit to it.
  const typed = useMemo(() => parseEndpoint(url), [url]);

  const insufficient = hw?.verdict === 'insufficient';
  // Two unrelated questions, kept apart:
  //   · `available`        — can this BUILD download Axom? (distribution)
  //   · `runtimeInstalled` — does this MACHINE already have one? (capability)
  // Gating distribution must never stop someone who already has a runtime
  // from starting it — that's how the machine serving turns all night gets
  // told the software is "coming soon".
  const runtimeInstalled = install.runtimeInstalled === true;
  // Distribution availability is data, not an error. `available === false`
  // means this build has no local-install path yet — the card says so quietly
  // and says nothing else. Undefined means we haven't heard back, so the
  // button waits rather than flashing an action that may not exist.
  const gated = !runtimeInstalled && install.available === false;
  const checkingAvailability = !runtimeInstalled && install.available === undefined;
  // Precedence: INSTALLED beats gated beats hardware verdict. Lead with the
  // state that determines what the user can actually do — an installed
  // runtime makes both the gate and the RAM floor irrelevant.
  const connectFirst = !runtimeInstalled && (gated || insufficient);
  const ramPct = hw && req ? Math.min(100, (hw.totalRamGb / req.recommendedRamGb) * 100) : 0;

  return (
    <div className="h-full axom-hero-bg overflow-y-auto lg:overflow-hidden relative">
      <div className={cn(
        'min-h-full lg:h-full w-full max-w-[1600px] mx-auto px-6 xl:px-12 py-6 grid grid-cols-1 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)] gap-8 xl:gap-14 items-center',
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
              {runtimeInstalled ? (
                <>
                  Axom is installed on this machine — start it and chat locally,
                  no other machine involved.
                </>
              ) : (
                <>
                  One verified download — runtime and models (~{req?.downloadGb ?? 4.4} GB) —
                  then your Axom lives on this machine, fully self-contained.
                </>
              )}
            </p>

            {runtimeInstalled ? (
              <div className="flex flex-col gap-2">
                <Button variant="primary" size="lg" onClick={useThisMachine} disabled={saving} className="w-full">
                  {saving ? <Loader2 size={15} className="mr-1.5 animate-spin" /> : <Atom size={15} className="mr-1.5" />}
                  Use this machine
                </Button>
                {install.runtimeCommand && (
                  <span className="font-mono text-2xs text-text-4 truncate" title={install.runtimeCommand}>
                    {install.runtimeCommand}
                  </span>
                )}
              </div>
            ) : gated ? (
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
              <Button variant="primary" size="lg" onClick={useThisMachine} disabled={saving} className="w-full">
                {saving ? <Loader2 size={15} className="mr-1.5 animate-spin" /> : <Atom size={15} className="mr-1.5" />}
                Start your Axom
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

// ── Runtime control — one state, one verb, rendered in place ───────────────
//
// Every field here comes from GET /api/axom/runtimes. `canStart`/`canStop`/
// `canHeal` are the daemon's answer about what this control mode permits in
// this state; the GUI never re-derives them. A verb the daemon didn't offer
// is a verb we can't honour, and a button that can't honour itself is a lie.

const RUNTIME_STATE = {
  connected:   { dot: 'running',   word: 'connected',   hint: 'events are flowing' },
  running:     { dot: 'starting',  word: 'running',     hint: 'answering, attaching to the event stream' },
  stopped:     { dot: 'completed', word: 'stopped',     hint: 'the machine is fine, the process is down' },
  unreachable: { dot: 'crashed',   word: 'unreachable', hint: "can't reach it from here" },
  unknown:     { dot: 'starting',  word: 'unknown',     hint: "we couldn't determine its state" },
};

const CONTROL_WORD = { local: 'this machine', ssh: 'over SSH', none: 'connect-only' };

// The single verb a state permits, or null. Order matters only in that a
// runtime is never both startable and stoppable.
function runtimeVerb(rt) {
  if (!rt) return null;
  if (rt.canStop) return { key: 'stop', label: 'Stop runtime', icon: Power, confirm: true };
  if (rt.canStart) return { key: 'start', label: 'Start runtime', icon: Play, confirm: false };
  if (rt.canHeal) return { key: 'heal', label: 'Heal tunnel', icon: Plug, confirm: false };
  return null;
}

function useRuntimeAction(rt) {
  const startAxomRuntimeById = useGrooveStore((s) => s.startAxomRuntimeById);
  const stopAxomRuntimeById = useGrooveStore((s) => s.stopAxomRuntimeById);
  const healAxomRuntimeById = useGrooveStore((s) => s.healAxomRuntimeById);
  const busy = useGrooveStore((s) => s.axomRuntimeBusy[rt?.id]) || null;
  const addToast = useGrooveStore((s) => s.addToast);
  const [confirming, setConfirming] = useState(false);
  const [forceNext, setForceNext] = useState(false);

  useEffect(() => {
    if (!confirming) return;
    const t = setTimeout(() => setConfirming(false), 5000);
    return () => clearTimeout(t);
  }, [confirming]);

  const verb = runtimeVerb(rt);

  async function run() {
    if (!verb || !rt) return;
    if (verb.confirm && !confirming) { setConfirming(true); return; }
    setConfirming(false);
    try {
      let result;
      if (verb.key === 'start') result = await startAxomRuntimeById(rt.id);
      else if (verb.key === 'stop') result = await stopAxomRuntimeById(rt.id, { force: forceNext });
      else result = await healAxomRuntimeById(rt.id);

      // A turn is in flight. Forcing is allowed by the contract but never
      // inherited from the first press — the escalation is offered.
      if (result?.turnInFlight) {
        setForceNext(true);
        setConfirming(true);
        addToast('warning', 'A turn is in flight', 'Press again to force it — that turn will not finish.');
        return;
      }
      if (result?.unsupported) {
        addToast('error', 'This runtime is still running',
          "It predates remote shutdown, so GROOVE can't stop it from here — stop it on the machine it runs on.");
        return;
      }
      setForceNext(false);
      addToast('success', verb.key === 'start' ? 'Runtime starting'
        : verb.key === 'stop' ? 'Runtime stopping' : 'Tunnel re-established');
    } catch (err) {
      setForceNext(false);
      addToast('error', `${verb.label} failed`, err.message);
    }
  }

  const label = busy ? 'Working…'
    : confirming ? (forceNext ? 'Force stop' : 'Confirm')
    : verb?.label;

  return { verb, run, busy, confirming, label };
}

// Header-sized control: state word + the one verb.
function RuntimeControl({ runtime }) {
  const { verb, run, busy, confirming, label } = useRuntimeAction(runtime);
  if (!runtime) return null;
  const meta = RUNTIME_STATE[runtime.state] || RUNTIME_STATE.unknown;

  return (
    <div className="flex items-center gap-2 flex-shrink-0">
      <span className="flex items-center gap-1.5" title={runtime.detail || meta.hint}>
        <StatusDot status={meta.dot} size="sm" />
        <span className="text-2xs text-text-3 font-medium whitespace-nowrap">{meta.word}</span>
      </span>
      {verb && (
        <button
          onClick={run}
          disabled={busy}
          className={cn(
            'flex items-center gap-1.5 h-7 px-2 rounded-md text-2xs font-medium transition-colors cursor-pointer whitespace-nowrap',
            'disabled:opacity-40 disabled:pointer-events-none',
            confirming ? 'bg-danger/10 text-danger' : 'text-text-3 hover:text-text-0 hover:bg-surface-2',
          )}
          title={runtime.detail || verb.label}
        >
          {busy ? <Loader2 size={12} className="animate-spin" /> : <verb.icon size={12} />}
          {label}
        </button>
      )}
    </div>
  );
}

// The card that replaces the input row when a runtime isn't ready to take a
// message. The transcript above stays visible in every state — history is
// never hidden because the process is down.
function RuntimeStateCard({ runtime, onManage }) {
  const { verb, run, busy, confirming, label } = useRuntimeAction(runtime);
  const meta = RUNTIME_STATE[runtime.state] || RUNTIME_STATE.unknown;

  // control:none has no lifecycle verbs — the honest sentence, and the place
  // to go say it: the machine that owns the process.
  const host = (() => {
    try { return runtime.url ? new URL(runtime.url).host : null; } catch { return null; }
  })();
  const sentence = runtime.detail
    || (runtime.control === 'none' && runtime.state === 'stopped'
      ? `Stopped — start it on ${host || 'the machine it runs on'}.`
      : meta.hint);

  return (
    <div className="flex-shrink-0 border-t border-border bg-surface-1/50 px-4 py-3">
      <div className="rounded-lg border border-border-subtle bg-surface-0 px-4 py-3 flex items-center gap-3">
        {/* `running` is transitional — it answers /about and the connector is
            attaching. A spinner says "wait", where a status dot says "state". */}
        {runtime.state === 'running'
          ? <Loader2 size={13} className="text-accent animate-spin flex-shrink-0" />
          : <StatusDot status={meta.dot} size="sm" />}
        <div className="min-w-0 flex flex-col">
          <span className="text-xs font-semibold text-text-1">
            {runtime.name} is {meta.word}
          </span>
          <span className="text-2xs text-text-4 leading-relaxed truncate">{sentence}</span>
        </div>
        <div className="ml-auto flex items-center gap-1.5 flex-shrink-0">
          {verb ? (
            <button
              onClick={run}
              disabled={busy}
              className={cn(
                'flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-medium transition-colors cursor-pointer',
                'disabled:opacity-40 disabled:pointer-events-none',
                confirming ? 'bg-danger/10 text-danger' : 'bg-accent/15 text-accent border border-accent/25 hover:bg-accent/25',
              )}
            >
              {busy ? <Loader2 size={13} className="animate-spin" /> : <verb.icon size={13} />}
              {label}
            </button>
          ) : (
            <button
              onClick={onManage}
              className="flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-medium text-text-3 hover:text-text-0 hover:bg-surface-2 transition-colors cursor-pointer"
            >
              <Settings2 size={13} /> Runtimes
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Runtime switcher ───────────────────────────────────────────────────────

function RuntimeSwitcher({ runtimes, activeId, onManage }) {
  const activateAxomRuntime = useGrooveStore((s) => s.activateAxomRuntime);
  const addToast = useGrooveStore((s) => s.addToast);
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const active = runtimes.find((r) => r.id === activeId) || runtimes[0];

  useEffect(() => {
    if (!open) return;
    function onDoc(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  return (
    <div className="relative flex-shrink-0" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 h-7 px-2 rounded-md hover:bg-surface-2 transition-colors cursor-pointer max-w-[16rem]"
        title="Switch runtime"
      >
        <Atom size={13} className="text-accent flex-shrink-0" />
        <span className="text-xs font-semibold text-text-0 truncate">{active?.name || 'Axom'}</span>
        <ChevronDown size={11} className="text-text-4 flex-shrink-0" />
      </button>

      {open && (
        <div className="absolute top-8 left-0 z-30 w-72 rounded-lg border border-border bg-surface-2 shadow-lg py-1">
          {runtimes.map((rt) => {
            const meta = RUNTIME_STATE[rt.state] || RUNTIME_STATE.unknown;
            return (
              <button
                key={rt.id}
                onClick={() => {
                  setOpen(false);
                  if (rt.id !== activeId) {
                    activateAxomRuntime(rt.id).catch((err) => addToast('error', 'Could not switch runtime', err.message));
                  }
                }}
                className={cn(
                  'w-full flex items-center gap-2 px-3 py-2 text-left transition-colors cursor-pointer',
                  rt.id === activeId ? 'bg-surface-3' : 'hover:bg-surface-3/60',
                )}
              >
                <StatusDot status={meta.dot} size="sm" />
                <span className="flex flex-col min-w-0">
                  <span className="text-xs text-text-1 truncate">{rt.name}</span>
                  <span className="font-mono text-2xs text-text-4 truncate">
                    {meta.word} · {CONTROL_WORD[rt.control] || rt.control}
                  </span>
                </span>
                {rt.id === activeId && <Check size={12} className="ml-auto text-accent flex-shrink-0" />}
              </button>
            );
          })}
          <div className="h-px bg-border-subtle my-1" />
          <button
            onClick={() => { setOpen(false); onManage(); }}
            className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs text-text-3 hover:text-text-0 hover:bg-surface-3/60 transition-colors cursor-pointer"
          >
            <Plus size={12} /> Add or edit runtimes…
          </button>
        </div>
      )}
    </div>
  );
}

// ── Runtime manager — a panel OVER the workspace, never a navigation ───────

const BLANK_DRAFT = { name: '', control: 'none', url: '', host: '', user: '', command: '' };

function RuntimeManager({ runtimes, activeId, onClose }) {
  const addAxomRuntime = useGrooveStore((s) => s.addAxomRuntime);
  const removeAxomRuntime = useGrooveStore((s) => s.removeAxomRuntime);
  const activateAxomRuntime = useGrooveStore((s) => s.activateAxomRuntime);
  const install = useGrooveStore((s) => s.axomInstall);
  const addToast = useGrooveStore((s) => s.addToast);
  const [draft, setDraft] = useState(BLANK_DRAFT);
  const [saving, setSaving] = useState(false);

  const typed = useMemo(() => parseEndpoint(draft.url), [draft.url]);
  const runtimeInstalled = install.runtimeInstalled === true;

  async function add(spec) {
    setSaving(true);
    try {
      await addAxomRuntime(spec);
      setDraft(BLANK_DRAFT);
      addToast('success', 'Runtime added');
    } catch (err) {
      addToast('error', 'Could not add runtime', err.message);
    } finally {
      setSaving(false);
    }
  }

  function submit() {
    const name = draft.name.trim();
    if (draft.control === 'ssh') {
      if (!draft.host.trim()) return;
      return add({
        name: name || draft.host.trim(),
        control: 'ssh',
        ssh: { host: draft.host.trim(), user: draft.user.trim() || undefined, command: draft.command.trim() || undefined },
        activate: true,
      });
    }
    if (!draft.url.trim()) return;
    return add({ name: name || typed?.host || 'Axom', control: 'none', url: draft.url.trim(), activate: true });
  }

  return (
    <div className="absolute inset-0 z-40 flex justify-end bg-surface-0/60 backdrop-blur-sm" onMouseDown={onClose}>
      <div
        className="w-[26rem] max-w-full h-full bg-surface-1 border-l border-border flex flex-col"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="h-10 flex-shrink-0 px-4 flex items-center gap-2 border-b border-border-subtle">
          <Atom size={13} className="text-accent" />
          <span className="text-xs font-semibold text-text-0">Runtimes</span>
          <button
            onClick={onClose}
            className="ml-auto h-6 w-6 flex items-center justify-center rounded text-text-4 hover:text-text-1 hover:bg-surface-2 transition-colors cursor-pointer"
          >
            <X size={12} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            {runtimes.map((rt) => {
              const meta = RUNTIME_STATE[rt.state] || RUNTIME_STATE.unknown;
              return (
                <div key={rt.id} className="rounded-lg border border-border-subtle bg-surface-2 px-3 py-2.5 flex items-center gap-2.5">
                  <StatusDot status={meta.dot} size="sm" />
                  <div className="min-w-0 flex flex-col">
                    <span className="text-xs text-text-1 truncate">{rt.name}</span>
                    <span className="font-mono text-2xs text-text-4 truncate" title={rt.url || ''}>
                      {meta.word} · {CONTROL_WORD[rt.control] || rt.control}
                    </span>
                  </div>
                  <div className="ml-auto flex items-center gap-1 flex-shrink-0">
                    {rt.id !== activeId && (
                      <button
                        onClick={() => activateAxomRuntime(rt.id).catch((err) => addToast('error', 'Switch failed', err.message))}
                        className="h-6 px-2 rounded text-2xs text-text-3 hover:text-text-0 hover:bg-surface-3 transition-colors cursor-pointer"
                      >
                        Use
                      </button>
                    )}
                    <button
                      onClick={() => removeAxomRuntime(rt.id).catch((err) => addToast('error', 'Remove failed', err.message))}
                      className="h-6 w-6 flex items-center justify-center rounded text-text-4 hover:text-danger hover:bg-danger/10 transition-colors cursor-pointer"
                      title="Remove this runtime. The process itself is untouched."
                    >
                      <X size={11} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {runtimeInstalled && !runtimes.some((r) => r.control === 'local') && (
            <Button
              variant="primary" size="lg" disabled={saving}
              onClick={() => add({ name: 'This machine', control: 'local', activate: true })}
            >
              <Atom size={14} className="mr-1.5" /> Use this machine
            </Button>
          )}

          <div className="flex flex-col gap-2.5">
            <span className="text-2xs uppercase tracking-[0.12em] text-text-4 font-semibold">Add a runtime</span>
            <div className="flex gap-1">
              {[['none', 'By URL'], ['ssh', 'Over SSH']].map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setDraft({ ...draft, control: key })}
                  className={cn(
                    'h-7 px-2.5 rounded text-2xs font-medium transition-colors cursor-pointer',
                    draft.control === key ? 'bg-surface-3 text-text-0' : 'text-text-4 hover:text-text-2 hover:bg-surface-2',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            <Input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="Name (optional)"
              className="text-xs"
            />

            {draft.control === 'ssh' ? (
              <>
                <Input value={draft.host} onChange={(e) => setDraft({ ...draft, host: e.target.value })}
                  placeholder="host — e.g. spark.local" className="font-mono text-xs" />
                <Input value={draft.user} onChange={(e) => setDraft({ ...draft, user: e.target.value })}
                  placeholder="ssh user (optional)" className="font-mono text-xs" />
                <Input value={draft.command} onChange={(e) => setDraft({ ...draft, command: e.target.value })}
                  placeholder="launch command (optional)" className="font-mono text-xs" />
                <p className="text-2xs text-text-4 leading-relaxed">
                  GROOVE starts and stops this runtime over SSH and keeps the port-forward
                  healthy. It never edits your launch command.
                </p>
              </>
            ) : (
              <>
                <Input value={draft.url} onChange={(e) => setDraft({ ...draft, url: e.target.value })}
                  placeholder="http://127.0.0.1:8737" className="font-mono text-xs" />
                {typed && !typed.invalid && !typed.local && (
                  <div className="rounded-md border border-warning/25 bg-warning/[0.06] px-3 py-2.5 flex flex-col gap-1.5">
                    <span className="flex items-center gap-1.5 text-xs font-semibold text-warning">
                      <TriangleAlert size={12} /> {typed.host} can't be reached directly
                    </span>
                    <TunnelHint parsed={typed} onCopy={(v) => { navigator.clipboard.writeText(v); addToast('success', 'Copied'); }} />
                    <p className="text-2xs text-text-4">Or add it over SSH instead and GROOVE handles the forward.</p>
                  </div>
                )}
                <p className="text-2xs text-text-4 leading-relaxed">
                  Connect-only: GROOVE reads its events and can't start or stop it.
                </p>
              </>
            )}

            <Button
              variant="secondary"
              onClick={submit}
              disabled={saving || (draft.control === 'ssh' ? !draft.host.trim() : !draft.url.trim())}
            >
              <Plus size={13} className="mr-1.5" /> Add runtime
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Header — who we're connected to, and what state it's in ────────────────

function RuntimeHeader({ runtime, runtimes, activeId, endpoint, anomalies, onManage }) {
  const addToast = useGrooveStore((s) => s.addToast);
  const about = runtime?.about || endpoint?.about;

  return (
    <div className="flex-shrink-0 h-10 border-b border-border-subtle bg-surface-1 px-3 flex items-center gap-3">
      <RuntimeSwitcher runtimes={runtimes} activeId={activeId} onManage={onManage} />

      {runtime?.url && (
        <button
          onClick={() => { navigator.clipboard.writeText(runtime.url); addToast('success', 'Endpoint copied'); }}
          className="font-mono text-2xs text-text-4 hover:text-accent truncate max-w-[14rem] cursor-pointer transition-colors flex-shrink-0"
          title={`${CONTROL_WORD[runtime.control] || runtime.control} — click to copy`}
        >
          {runtime.url}
        </button>
      )}

      {/* An idle-unloaded chassis is a healthy runtime resting, not a fault —
          it reloads on the next message, so it reads as state, not error. */}
      {about?.chassis?.loaded === false && (
        <span className="font-mono text-2xs text-text-4 flex-shrink-0 hidden lg:inline" title="The chassis unloaded after an idle timeout — the session and its ledger are intact">
          chassis idle · reloads on next message
        </span>
      )}

      {/* State — the only place hue is allowed up here */}
      {runtime?.error && runtime.state !== 'connected' && (
        <span className="flex items-center gap-1.5 text-2xs text-danger min-w-0" title={runtime.error}>
          <TriangleAlert size={11} className="flex-shrink-0" />
          <span className="truncate">{runtime.error}</span>
        </span>
      )}
      {(endpoint?.drift?.novel?.length > 0 || endpoint?.drift?.missing?.length > 0) && (
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

      <div className="ml-auto flex items-center gap-2 flex-shrink-0">
        <RuntimeControl runtime={runtime} />
        <span aria-hidden className="h-4 w-px bg-border" />
        <button
          onClick={onManage}
          className="flex items-center gap-1.5 h-7 px-2 rounded-md text-2xs font-medium text-text-4 hover:text-text-1 hover:bg-surface-2 transition-colors cursor-pointer"
          title="Add, switch or remove runtimes"
        >
          <Settings2 size={12} /> Runtimes
        </button>
      </div>
    </div>
  );
}

// ── Sessions — a tab strip, not a sidebar ──────────────────────────────────

// ── Chats — the left-hand furniture ────────────────────────────────────────
//
// The list is the daemon's (GET /api/axom/chats), never synthesized from the
// runtime's live sessions: the daemon remembers rows the user cleared, and
// re-deriving them from live sessions would resurrect exactly those.
//
// "Remove" hides a row. It does not delete a conversation — the transcript
// stays in Axom's ledger — so the control says what it does and never says
// "delete" for an operation that deletes nothing.

function ChatRow({ chat, active, holder, onOpen, onRemove, onRename }) {
  const [confirming, setConfirming] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(chat.label || '');

  useEffect(() => {
    if (!confirming) return;
    const t = setTimeout(() => setConfirming(false), 5000);
    return () => clearTimeout(t);
  }, [confirming]);

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { setEditing(false); if (draft.trim() && draft !== chat.label) onRename(draft.trim()); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') { setDraft(chat.label || ''); setEditing(false); }
        }}
        className="w-full h-7 px-2 rounded bg-surface-0 border border-accent/40 text-[12px] font-sans text-text-0 focus:outline-none"
      />
    );
  }

  return (
    <div
      className={cn(
        'group flex items-center gap-2 h-7 pl-2 pr-1 rounded transition-colors cursor-pointer',
        active ? 'bg-surface-3 text-text-0' : 'text-text-3 hover:bg-surface-2 hover:text-text-1',
      )}
      onClick={onOpen}
      onDoubleClick={() => setEditing(true)}
      title={chat.session}
    >
      {/* Which thread Axom is actually working on, at a glance. */}
      {holder ? (
        <span className="relative flex items-center justify-center w-2.5 h-2.5 flex-shrink-0" title="Axom is generating on this chat">
          <span className="absolute inset-0 rounded-full bg-accent/30 animate-ping [animation-duration:2s]" />
          <span className="relative w-1.5 h-1.5 rounded-full bg-accent" />
        </span>
      ) : (
        <MessageSquare size={11} className="flex-shrink-0 opacity-60" />
      )}
      <span className="text-[12px] font-sans truncate flex-1 min-w-0">{chat.label || chat.session}</span>
      {confirming ? (
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          className="text-[10px] font-sans text-warning hover:text-warning/80 px-1 flex-shrink-0 cursor-pointer"
          title="The conversation stays in Axom's memory — this only clears the row"
        >
          Remove?
        </button>
      ) : (
        <button
          onClick={(e) => { e.stopPropagation(); setConfirming(true); }}
          className="h-5 w-5 flex items-center justify-center rounded text-text-4 hover:text-text-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 cursor-pointer"
          title="Remove from list — the conversation stays in Axom's memory"
        >
          <X size={11} />
        </button>
      )}
    </div>
  );
}

function ChatSidebar({ runtime, chats, holderSession, onShowActivity, activityOpen }) {
  const axomSelected = useGrooveStore((s) => s.axomSelected);
  const selectAxomSession = useGrooveStore((s) => s.selectAxomSession);
  const hookAxom = useGrooveStore((s) => s.hookAxom);
  const renameAxomChat = useGrooveStore((s) => s.renameAxomChat);
  const hideAxomChat = useGrooveStore((s) => s.hideAxomChat);
  const addToast = useGrooveStore((s) => s.addToast);
  const [hooking, setHooking] = useState(false);

  const mine = (chats || []).filter((c) => !runtime || c.runtimeId === runtime.id);

  async function newChat() {
    setHooking(true);
    try {
      await hookAxom({ runtimeId: runtime?.id, label: nextChatLabel(chats, runtime?.id) });
    } catch (err) {
      addToast('error', 'Could not open a new chat', err.message);
    } finally {
      setHooking(false);
    }
  }

  return (
    <div className="w-56 xl:w-64 flex-shrink-0 border-r border-border-subtle bg-surface-1 flex flex-col min-h-0">
      <div className="flex-shrink-0 p-2">
        <button
          onClick={newChat}
          disabled={hooking}
          className="w-full flex items-center gap-2 h-8 px-2 rounded-md border border-border-subtle bg-surface-2 hover:bg-surface-3 hover:border-border text-text-1 transition-colors cursor-pointer disabled:opacity-50"
          title="A fresh thread on the same Axom — same memory, its own recency scope"
        >
          {hooking ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
          <span className="text-[12px] font-sans font-medium">New chat</span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-2 flex flex-col gap-0.5 min-h-0">
        {chats === null && (
          <div className="flex items-center gap-2 px-2 py-1.5 text-text-4">
            <Loader2 size={11} className="animate-spin" />
            <span className="text-[11px] font-sans">Loading chats…</span>
          </div>
        )}
        {chats !== null && mine.length === 0 && (
          <p className="px-2 py-1.5 text-[11px] font-sans text-text-4 leading-relaxed">
            No chats yet. Start one — it stays here across reloads.
          </p>
        )}
        {mine.map((c) => (
          <ChatRow
            key={c.session}
            chat={c}
            active={axomSelected?.session === c.session}
            holder={holderSession === c.session}
            onOpen={() => selectAxomSession(c.runtimeId || runtime?.id, c.session)}
            onRename={(label) => renameAxomChat(c.session, label).catch((err) => addToast('error', 'Rename failed', err.message))}
            onRemove={() => hideAxomChat(c.session).catch((err) => addToast('error', 'Could not remove', err.message))}
          />
        ))}
      </div>

      <div className="flex-shrink-0 border-t border-border-subtle p-2">
        <button
          onClick={onShowActivity}
          className={cn(
            'w-full flex items-center gap-2 h-7 px-2 rounded-md transition-colors cursor-pointer',
            activityOpen ? 'bg-surface-3 text-text-1' : 'text-text-4 hover:text-text-1 hover:bg-surface-2',
          )}
          title="The raw event stream behind this chat"
        >
          <Radio size={12} />
          <span className="text-[11px] font-sans">Activity</span>
        </button>
      </div>
      <InstanceControls />
    </div>
  );
}

// ── Local instance controls (rail footer) ──────────────────────────────────

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

// ── Event vocabulary ───────────────────────────────────────────────────────

function payloadPreview(payload) {
  if (payload == null) return '';
  if (typeof payload === 'string') return payload;
  const text = payload.text || payload.thought || payload.content;
  if (typeof text === 'string') return text;
  try { return JSON.stringify(payload); } catch { return String(payload); }
}

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
// Returns null when the payload names no tool — the caller decides whether
// that means the verbatim envelope (rail) or a generic line (transcript).
// Never JSON dressed as a tool name.
function toolLabel(payload, kind) {
  const name = payload?.tool || payload?.name || payload?.tool_name;
  let arg = payload?.arg ?? payload?.args ?? payload?.input ?? payload?.query;
  if (arg && typeof arg === 'object') {
    arg = Object.values(arg).find((v) => typeof v === 'string' && v.length < 120);
  }
  if (typeof name !== 'string' || !name.trim()) return null;
  const verb = kind === 'tool_end' ? 'finished' : 'running';
  return [`${verb} ${name.trim()}`, typeof arg === 'string' ? arg : null].filter(Boolean).join(' · ');
}

// One readable line per event kind for the activity rail.
//
// Two rules hold this together, because this vocabulary is now the primary
// way a user perceives the machinery:
//   1. A summary renders ONLY the payload fields that are actually there. No
//      "?" placeholders standing in for absent data — a line that says
//      "wearing ?" or "champion → ?" reads as knowledge we don't have.
//   2. A renderer that cannot say something true returns null, and the row
//      falls back to the verbatim envelope in mono. Raw is not a failure
//      state here; it's the honest floor, and it's what the whole rail
//      degrades to when Axom grows kinds this build has never seen.
const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const join = (...parts) => parts.filter(Boolean).join(' · ');

// Prose the runtime actually wrote. Deliberately NOT payloadPreview, which
// falls back to JSON.stringify: a serialized payload rendered in sans type
// on a curated line passes for a sentence the runtime never said. When there
// is no prose, this returns null and the row degrades to the verbatim floor.
const prose = (p) => (typeof p === 'string' ? str(p) : str(p?.text) || str(p?.thought) || str(p?.content));

const EVENT_LINE = {
  pipeline_start: { icon: Play, text: (p) => join('turn started', str(p.mode)) },
  firing_start: { icon: Zap, text: (p) => join('firing', str(p.leaf_id), str(p.agent_type)) },
  step_start: {
    icon: ChevronRight,
    text: (p, e) => {
      const n = p.step ?? e.step;
      return n == null ? 'step' : `step ${n}`;
    },
  },
  leaf_swap: {
    icon: Shirt,
    // The wardrobe law: only a named leaf may be claimed as worn.
    text: (p) => (leafOf(p) ? `wearing ${leafOf(p)}` : 'leaf swap · leaf not named'),
  },
  thought: { icon: Brain, text: (p) => prose(p) },
  tool_start: { icon: Wrench, text: (p) => str(toolLabel(p, 'tool_start')) },
  tool_end: { icon: Wrench, text: (p) => str(toolLabel(p, 'tool_end')) },
  narration: { icon: MessageSquareQuote, text: (p) => prose(p) },
  text: { icon: Type, text: (p) => prose(p) },
  resolution: { icon: CheckCircle2, text: (p) => prose(p) },
  candidate_arrived: {
    icon: Trophy,
    text: (p) => join('candidate', str(p.leaf_id), p.banked ? 'banked' : null),
  },
  champion_changed: {
    icon: Trophy,
    text: (p) => (str(p.to)
      ? join(`champion → ${str(p.to)}`, str(p.rule) && `rule ${str(p.rule)}`)
      : 'champion changed · winner not named'),
  },
  candidate_banked: { icon: Trophy, text: () => 'candidate banked' },
  confidence_updated: {
    icon: Gauge,
    text: (p) => join(
      'confidence',
      p.candidates != null && `${p.candidates} candidates`,
      p.n_fused != null && p.n_agents != null && `${p.n_fused}/${p.n_agents} fused`,
      p.n_facts != null && `${p.n_facts} facts`,
    ),
  },
  evidence_scored: { icon: Gauge, text: (p) => join('evidence', str(p.source)) },
  firing_end: {
    icon: CheckCircle2,
    text: (p) => join('firing done', p.tokens_generated != null && `${p.tokens_generated} tok`),
  },
  // §8 pins stopped_early; its absence on a done pipeline means it ran to
  // completion, so "turn complete" is a reading of the contract, not a guess.
  pipeline_done: { icon: CheckCircle2, text: (p) => (p.stopped_early === true ? 'turn stopped early' : 'turn complete') },
  interrupt: { icon: Zap, text: (p) => (prose(p) ? `steer · ${prose(p)}` : 'steer') },
  interrupt_ack: { icon: Zap, text: () => 'steer acknowledged' },
  stop_requested: { icon: OctagonX, text: () => 'stop requested', tone: 'text-danger' },
  stop_effected: { icon: OctagonX, text: () => 'stopped', tone: 'text-danger' },
};

// What a row shows when no vocabulary applies — an unmapped kind, or a
// mapped one whose payload couldn't support a truthful summary. Mono type
// marks it as verbatim so it never passes for a curated line.
function eventLine(e) {
  const spec = EVENT_LINE[e.kind];
  const text = spec ? spec.text(e.payload || {}, e) : null;
  if (text) return { icon: spec.icon, text, tone: spec.tone, raw: false };
  return {
    icon: spec?.icon || Code2,
    text: join(e.kind, str(payloadPreview(e.payload))) || e.kind,
    tone: spec?.tone,
    raw: true,
  };
}

// ── Activity rail — the machinery, always visible ──────────────────────────
//
// Ryan works with this open: it is the realtime log of everything happening
// behind the scenes. Readable by default, verbatim on demand — the raw
// envelopes never stop being one click away, because they are the ground
// truth every line above is derived from.

function ActivityRail({ events, highlight, onHighlight, live, onClose }) {
  const scrollRef = useRef(null);
  const pinnedRef = useRef(true);
  const [raw, setRaw] = useState(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && pinnedRef.current && !highlight) el.scrollTop = el.scrollHeight;
  }, [events.length, highlight, raw]);

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
    <div className="w-72 xl:w-80 flex-shrink-0 border-l border-border-subtle bg-surface-1 flex flex-col min-h-0">
      <div className="flex-shrink-0 h-10 px-3 flex items-center gap-2 border-b border-border-subtle">
        {live ? (
          <span className="relative flex items-center justify-center w-3 h-3 flex-shrink-0">
            <span className="absolute inset-0 rounded-full bg-accent/25 animate-ping [animation-duration:2s]" />
            <span className="relative w-1.5 h-1.5 rounded-full bg-accent" />
          </span>
        ) : (
          <Radio size={11} className="text-text-4 flex-shrink-0" />
        )}
        <span className="text-2xs uppercase tracking-[0.12em] text-text-4 font-semibold">Activity</span>
        <span className="font-mono text-2xs text-text-4">{events.length}</span>
        <button
          onClick={() => setRaw((v) => !v)}
          className={cn(
            'ml-auto h-6 px-1.5 rounded font-mono text-2xs transition-colors cursor-pointer',
            raw ? 'bg-surface-3 text-text-1' : 'text-text-4 hover:text-text-1 hover:bg-surface-2',
          )}
          title={raw ? 'Show readable lines' : 'Show the raw envelopes'}
        >
          raw
        </button>
        <button
          onClick={onClose}
          className="h-6 w-6 flex items-center justify-center rounded text-text-4 hover:text-text-1 hover:bg-surface-2 transition-colors cursor-pointer"
          title="Close"
        >
          <X size={12} />
        </button>
      </div>

      <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto px-2 py-2">
        {events.length === 0 && (
          <p className="px-1 text-xs text-text-4 leading-relaxed">
            Nothing yet. Every step the runtime takes shows up here as it happens.
          </p>
        )}

        {raw ? (
          <div className="font-mono text-2xs leading-5">
            {events.map((e) => (
              <div
                key={e.id}
                data-ev={e.id}
                className={cn(
                  'flex gap-1.5 items-baseline rounded px-1 transition-colors',
                  cited.has(e.id) ? 'bg-accent/10 ring-1 ring-accent/30' : 'hover:bg-surface-2',
                )}
              >
                <span className="text-text-4/70 flex-shrink-0">{e.id.replace(/^ev-0*/, '')}</span>
                <span className="text-text-2 flex-shrink-0">{e.kind}</span>
                <span className="text-text-4 truncate">{payloadPreview(e.payload)}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col">
            {events.map((e) => {
              const line = eventLine(e);
              const Icon = line.icon;
              const isCited = cited.has(e.id);
              return (
                <button
                  key={e.id}
                  data-ev={e.id}
                  onClick={() => onHighlight(isCited ? null : { narrationId: `ev:${e.id}`, ids: [e.id] })}
                  className={cn(
                    'group flex items-start gap-2 py-1 px-1 rounded text-left transition-colors cursor-pointer',
                    isCited ? 'bg-accent/10' : 'hover:bg-surface-2',
                  )}
                  title={`${e.id} · ${e.kind}${line.raw ? ' — shown verbatim: no summary this build can vouch for' : ''}`}
                >
                  <Icon size={10} className={cn('mt-[3px] flex-shrink-0', line.tone || (isCited ? 'text-accent' : 'text-text-4'))} />
                  <span className={cn(
                    'text-[11px] leading-snug line-clamp-2 min-w-0 flex-1',
                    line.raw ? 'font-mono text-text-4' : 'font-sans',
                    line.tone || (line.raw ? '' : 'text-text-3'),
                  )}>
                    {line.text}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Conversation model — events folded into turns ──────────────────────────
//
// The stream is a transcript, not a log dump. Lifecycle kinds
// (pipeline/firing/step boundaries) are structure: they open and close turns
// rather than earning rows of their own — the rail carries them instead.
// Everything rendered still traces to an event id; nothing is synthesized.

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
  // One loader per turn: mechanism accumulates into a single block wherever it
  // first appeared, instead of a new row every time reasoning interleaves.
  function activity(e) {
    const t = current(e.id);
    let block = t.blocks.find((b) => b.type === 'activity');
    if (!block) {
      block = { type: 'activity', id: e.id, items: [] };
      t.blocks.push(block);
    }
    return block;
  }
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

      // Mechanism collapses into ONE loader per turn rather than waterfalling
      // rows between the reasoning. Nothing is lost: every envelope is still
      // in the activity drawer and the raw ticker, and the loader itself
      // expands to the full list. This is presentation, not omission.
      case 'tool_start': {
        const name = p?.tool || p?.name || p?.tool_name || null;
        activity(e).items.push({
          id: e.id, kind: 'tool', name,
          text: toolLabel(p, 'tool_start') || `tool ${payloadPreview(p)}`.trim(),
          done: false,
        });
        break;
      }

      case 'tool_end': {
        // An end closes ITS start (same tool name), so "3 tools" counts tools
        // and not envelopes. An end with no matching start is its own entry —
        // dropping it would hide work that happened.
        const name = p?.tool || p?.name || p?.tool_name || null;
        const items = activity(e).items;
        const open = [...items].reverse().find((i) => i.kind === 'tool' && !i.done && (!name || i.name === name));
        if (open) {
          open.done = true;
          if (!open.name && name) open.name = name;
        } else {
          items.push({
            id: e.id, kind: 'tool', name,
            text: toolLabel(p, 'tool_end') || `tool ${payloadPreview(p)}`.trim(),
            done: true,
          });
        }
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

      // A resolution is the settled answer — authoritative and complete, NOT a
      // continuation of the streamed fragments. Those fragments were the draft
      // of this same answer, so rendering both reads as Axom answering twice.
      // The resolution SUPERSEDES its draft: one answer, with the draft kept
      // (collapsed) because it is real output and discarding it would hide
      // what the runtime actually emitted.
      case 'resolution': {
        const chunk = payloadPreview(p);
        if (!chunk) break;
        const blocks = current(e.id).blocks;
        const draftAt = blocks.findLastIndex((b) => b.type === 'answer' && !b.final);
        const draft = draftAt >= 0 ? blocks[draftAt] : null;
        // Only supersede a draft that is genuinely this answer's own. A draft
        // the resolution does not restate is separate content, and replacing
        // it would silently drop something Axom said.
        if (draft && draft.text.trim() !== chunk.trim()) {
          blocks.splice(draftAt, 1);
          push({ type: 'answer', id: e.id, text: chunk, final: true, ids: [e.id], draft });
        } else if (draft) {
          blocks.splice(draftAt, 1);
          push({ type: 'answer', id: e.id, text: chunk, final: true, ids: [e.id, ...draft.ids] });
        } else {
          push({ type: 'answer', id: e.id, text: chunk, final: true, ids: [e.id] });
        }
        break;
      }

      case 'leaf_swap':
        activity(e).items.push({
          id: e.id, kind: 'leaf', done: true,
          text: leafOf(p) ? `wearing ${leafOf(p)}` : 'leaf swap · leaf not named',
        });
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
//
// THREE type sizes in this column, no more:
//   · 12px sans — prose the runtime or the user wrote (answers, messages)
//   · 11px sans — secondary material: thoughts, narration, tool lines, labels
//   · 10px mono — ground truth only: event ids, kinds, counters
// and ONE gutter: every non-bubble block hangs off the same 14px left rail,
// so thoughts, tools, narration and answers form a single column the eye can
// follow. The rail's colour is the only thing that varies — accent for the
// answer, subtle for the instrument lines beside it. Nothing is hidden or
// summarised away; it is sized and aligned so the information reads.

function UserTurn({ text, status }) {
  return (
    <div className="flex justify-end pl-8">
      <div className="max-w-[90%]">
        <div className="px-3.5 py-2.5 rounded-lg border border-accent/25 bg-accent/10">
          <div className="text-[12px] font-sans whitespace-pre-wrap break-words leading-relaxed text-text-0">
            {text}
          </div>
        </div>
        {status && (
          <div className={cn('text-[10px] font-mono mt-1 text-right', status.stale ? 'text-warning' : 'text-text-4')}>
            {status.label}
          </div>
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
      <div className="max-w-[90%]">
        <div className="px-3 py-1.5 rounded-lg border border-border bg-surface-2">
          <span className="flex items-center gap-1.5 text-[12px] font-sans text-text-1 leading-relaxed">
            <Zap size={11} className="text-accent flex-shrink-0" />
            {block.text}
          </span>
        </div>
        <div className="text-[10px] font-mono text-text-4 mt-1 text-right">
          {block.acked ? 'acked' : 'heard'}
        </div>
      </div>
    </div>
  );
}

function ThoughtBlock({ block }) {
  const [open, setOpen] = useState(false);
  const shown = open ? block.items : block.items.slice(-1);
  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 mb-1 text-[11px] text-text-4 hover:text-text-2 font-sans transition-colors cursor-pointer"
      >
        <Brain size={11} />
        {block.items.length === 1 ? 'thought' : `${block.items.length} thoughts`}
        {block.items.length > 1 && <ChevronDown size={10} className={cn('transition-transform', open && 'rotate-180')} />}
      </button>
      <div className="pl-3.5 border-l border-border-subtle flex flex-col gap-1">
        {shown.map((t) => (
          <p key={t.id} className="text-[11px] font-sans text-text-3 leading-relaxed">{t.text}</p>
        ))}
      </div>
    </div>
  );
}

// The agentic loader — the fleet's pattern, one per turn.
//
// Live: "Axom is working" with the tool currently running, cycling if several
// are in flight. Settled: a single quiet line ("3 tools"), expandable to the
// full list. The specifics live in the activity drawer; this is the summary
// the conversation needs, not the mechanism it used to waterfall.
function ActivityBlock({ block, live }) {
  const [open, setOpen] = useState(false);
  const [cycle, setCycle] = useState(0);
  const items = block.items;
  const tools = items.filter((i) => i.kind === 'tool');
  const running = items.filter((i) => !i.done);
  const isLive = live && running.length > 0;

  useEffect(() => {
    if (!isLive || running.length <= 1) return;
    const t = setInterval(() => setCycle((i) => (i + 1) % running.length), 1500);
    return () => clearInterval(t);
  }, [isLive, running.length]);

  if (isLive) {
    const cur = running[Math.min(cycle, running.length - 1)];
    return (
      <div className="pl-3.5 border-l border-border-subtle py-0.5">
        <span className="flex items-center gap-2 min-w-0">
          <Loader2 size={11} className="text-accent animate-spin flex-shrink-0" />
          <span className="text-[11px] text-text-2 font-sans flex-shrink-0">Axom is working</span>
          <span className="text-[11px] text-text-4 font-sans truncate min-w-0">{cur.text}</span>
          {running.length > 1 && (
            <span className="text-[10px] text-text-4 font-mono flex-shrink-0">{running.length}</span>
          )}
        </span>
      </div>
    );
  }

  if (items.length === 0) return null;

  const summary = [
    tools.length && `${tools.length} tool${tools.length === 1 ? '' : 's'}`,
    items.length - tools.length && `${items.length - tools.length} leaf swap${items.length - tools.length === 1 ? '' : 's'}`,
  ].filter(Boolean).join(' · ');

  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 pl-3.5 py-0.5 text-[11px] text-text-4 hover:text-text-2 font-sans transition-colors cursor-pointer"
        title="Every step is also in the activity drawer, verbatim"
      >
        <Wrench size={10} />
        {summary}
        <ChevronDown size={10} className={cn('transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="pl-3.5 border-l border-border-subtle flex flex-col">
          {items.map((it) => (
            <div key={it.id} className="flex items-center gap-2 py-0.5 group">
              {it.kind === 'leaf'
                ? <Shirt size={10} className="text-text-4 opacity-70 flex-shrink-0" />
                : <Wrench size={10} className="text-text-4 opacity-70 flex-shrink-0" />}
              <p className="text-[11px] text-text-3 font-sans truncate flex-1 min-w-0">{it.text}</p>
              <span className="text-[10px] text-text-4 font-mono opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                {it.id}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Narration keeps its provenance interaction — clicking reveals the cited
// envelopes inline and mirrors the selection into the activity rail.
function NarrationBlock({ block, eventsById, highlight, onHighlight }) {
  const active = highlight?.narrationId === block.id;
  return (
    <div>
      <button
        onClick={() => onHighlight(active ? null : { narrationId: block.id, ids: block.cites })}
        className={cn(
          'group w-full flex items-start gap-2 text-left pl-3.5 border-l border-border-subtle py-0.5 transition-colors cursor-pointer',
          active ? 'bg-surface-2/70' : 'hover:bg-surface-2/40',
        )}
        title="Show the events behind this line"
      >
        <MessageSquareQuote size={11} className={cn('mt-[3px] flex-shrink-0', active ? 'text-accent' : 'text-text-4')} />
        <span className="text-[11px] font-sans text-text-3 leading-relaxed">{block.text}</span>
        <span className={cn(
          'ml-auto flex-shrink-0 font-mono text-[10px] transition-colors',
          active ? 'text-accent' : 'text-text-4 opacity-0 group-hover:opacity-100',
        )}>
          {block.cites.length} cited
        </span>
      </button>
      {active && (
        <div className="ml-3.5 mt-1 rounded-md border border-border-subtle bg-surface-0 px-2 py-1.5 font-mono text-[10px] leading-5">
          {block.cites.map((id) => {
            const ev = eventsById[id];
            return (
              <div key={id} className="flex gap-2 items-baseline">
                <span className="text-text-4/70 flex-shrink-0">{id}</span>
                <span className={cn('flex-shrink-0', ev ? 'text-text-2' : 'text-warning')}>
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

function AnswerBlock({ block, endpointName }) {
  const [collapsed, setCollapsed] = useState(block.text.length > 600);
  const isLong = block.text.length > 600;
  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <span className="text-[11px] font-semibold text-text-1 font-sans">Axom</span>
        <span className="text-[11px] text-text-4 font-sans">{endpointName}</span>
        <span className="text-[10px] text-text-4 font-mono ml-auto">{block.final ? 'resolution' : 'text'}</span>
      </div>
      <div className="pl-3.5 py-1 border-l border-accent">
        <StructuredMessage text={collapsed ? `${block.text.slice(0, 600)}...` : block.text} />
      </div>
      {isLong && (
        <button
          onClick={() => setCollapsed((v) => !v)}
          className="ml-3.5 mt-1.5 flex items-center gap-1.5 text-[11px] text-accent/70 hover:text-accent font-sans font-medium cursor-pointer transition-colors"
        >
          <ChevronDown size={11} className={cn(!collapsed && 'rotate-180')} />
          {collapsed ? 'Show full response' : 'Collapse'}
        </button>
      )}
      {/* The streamed draft this resolution replaced. Kept, never dropped: it
          is output the runtime really emitted, and a reader comparing the two
          is doing exactly what a provenance-first surface should allow. */}
      {block.draft && <DraftBlock draft={block.draft} />}
    </div>
  );
}

function DraftBlock({ draft }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="ml-3.5 mt-1.5">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-[11px] text-text-4 hover:text-text-2 font-sans cursor-pointer transition-colors"
      >
        <ChevronDown size={11} className={cn(!open && '-rotate-90')} />
        {open ? 'Hide streamed draft' : 'Streamed draft'}
      </button>
      {open && (
        <div className="pl-3.5 mt-1 py-1 border-l border-border text-[11px] text-text-3 font-sans whitespace-pre-wrap">
          {draft.text}
        </div>
      )}
    </div>
  );
}

function Divider({ icon: Icon, text, tone }) {
  return (
    <div className="flex items-center gap-3 py-2">
      <div className="flex-1 h-px bg-border-subtle" />
      <span className={cn('flex items-center gap-1.5 text-[11px] font-sans flex-shrink-0', tone || 'text-text-4')}>
        {Icon && <Icon size={10} />} {text}
      </span>
      <div className="flex-1 h-px bg-border-subtle" />
    </div>
  );
}

function TurnView({ turn, live, endpointName, eventsById, highlight, onHighlight, prompt, ambiguous }) {
  // A turn with no prompt of ours shows NO bubble — a one-sided transcript
  // that's honest beats a complete one that's invented. But the two reasons
  // it can happen are different claims, and the label must not overreach:
  //   · nothing of ours is pending → another client genuinely started it.
  //   · something of ours IS pending → the slice declined an ambiguous
  //     attachment, so we know a prompt exists and can't say which. Saying
  //     "started elsewhere" there would assert something we can't back.
  const unclaimed = !prompt && !!turn.promptId;
  return (
    <div className="flex flex-col gap-2">
      {prompt && <UserTurn text={prompt} />}
      {unclaimed && <Divider text={ambiguous ? 'prompt not identified' : 'started elsewhere'} />}
      {turn.blocks.map((b) => {
        switch (b.type) {
          case 'thought': return <ThoughtBlock key={b.id} block={b} />;
          case 'activity': return <ActivityBlock key={b.id} block={b} live={live} />;
          case 'narration': return (
            <NarrationBlock key={b.id} block={b} eventsById={eventsById} highlight={highlight} onHighlight={onHighlight} />
          );
          case 'answer': return <AnswerBlock key={b.id} block={b} endpointName={endpointName} />;
          case 'steer': return <SteerLine key={b.id} block={b} />;
          case 'note': return <Divider key={b.id} icon={OctagonX} text={b.text} tone="text-danger" />;
          default: return null;
        }
      })}
      {turn.stopped && <Divider icon={OctagonX} text="stopped early" tone="text-danger" />}
    </div>
  );
}

function Conversation({ events, prompts, sessionLive, endpointName, highlight, onHighlight, queuedBehind }) {
  const scrollRef = useRef(null);
  const pinnedRef = useRef(true);
  const turns = useMemo(() => buildTurns(events), [events]);
  const eventsById = useMemo(() => Object.fromEntries(events.map((e) => [e.id, e])), [events]);

  useEffect(() => {
    const el = scrollRef.current;
    // Scoped to this pane only — never scrollIntoView (see ActivityRail).
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
    <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto px-4 py-4 space-y-5 min-h-0">
      {turns.length === 0 && pending.length === 0 && (
        <div className="flex flex-col items-center justify-center h-full text-center py-8">
          <div className="w-10 h-10 rounded-xl bg-surface-3 flex items-center justify-center mb-3">
            <Atom size={18} className="text-text-4" />
          </div>
          <p className="text-sm font-semibold text-text-0 font-sans">{endpointName}</p>
          <p className="text-xs text-text-3 font-sans mt-1">
            Send a message — every step it takes appears here, and every line cites the events behind it
          </p>
        </div>
      )}

      {turns.map((t, i) => (
        <TurnView
          key={t.id}
          turn={t}
          // §15: a turn's prompt is the entry the slice attached to that
          // turn's pipeline_start envelope — exact when client_ref round
          // trips, and never a guess when it doesn't.
          prompt={t.prompt || prompts.find((p) => p.attachedTo && p.attachedTo === t.promptId)?.text || null}
          ambiguous={pending.length > 0}
          live={sessionLive && i === turns.length - 1 && !t.done}
          endpointName={endpointName}
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

      <AnimatePresence>
        {/* §10 honesty constraint: hooks share one generation slot. A spinner
            while another session holds it would claim work is happening on
            THIS thread when nothing is. Queued says queued. */}
        {queuedBehind ? (
          <motion.div
            key="queued"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            className="flex items-center gap-2 text-text-4"
          >
            <Hourglass size={12} className="flex-shrink-0" />
            <span className="text-[11px] font-sans">
              Waiting for {queuedBehind.label} to finish — same Axom, currently answering elsewhere.
            </span>
          </motion.div>
        ) : awaiting && (
          <motion.div
            key="thinking"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
          >
            <ThinkingIndicator agent={{ name: 'Axom' }} />
          </motion.div>
        )}
      </AnimatePresence>
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
    <div className="flex-shrink-0 h-7 border-b border-border-subtle px-4 flex items-center gap-2 overflow-x-auto">
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
    <div className="flex-shrink-0 border-t border-border-subtle bg-surface-1 px-4">
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

function HotInput({ sessionLive, rollup, queuedBehind }) {
  const axomSelected = useGrooveStore((s) => s.axomSelected);
  const interrupts = useGrooveStore((s) => s.axomInterrupts);
  const stops = useGrooveStore((s) => s.axomStops);
  const sendAxomInterrupt = useGrooveStore((s) => s.sendAxomInterrupt);
  const sendAxomMessage = useGrooveStore((s) => s.sendAxomMessage);
  const sendAxomStop = useGrooveStore((s) => s.sendAxomStop);
  const addToast = useGrooveStore((s) => s.addToast);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const inputRef = useRef(null);

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
    setSending(true);
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
    } finally {
      setSending(false);
      inputRef.current?.focus();
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
    <div className="bg-surface-1/50 flex-shrink-0 border-t border-border">
      <div className="px-4 py-3 flex flex-col gap-1.5">
        {/* Said before you type, not discovered after you send. */}
        {queuedBehind && (
          <div className="flex items-center gap-2 px-1 text-text-4">
            <Hourglass size={11} className="flex-shrink-0" />
            <span className="text-[11px] font-sans">
              {queuedBehind.label} is generating — your message will start when that turn ends.
            </span>
            {queuedBehind.session && (
              <span className="font-mono text-[10px] text-text-4/70" title="the session holding the generation slot">
                {queuedBehind.session}
              </span>
            )}
          </div>
        )}
        {(pending.length > 0 || stopState || rollup) && (
          <div className="flex items-center gap-2 flex-wrap font-mono text-[10px] text-text-4">
            {pending.map(([id, entry]) => (
              <span key={id} title={entry.text} className="max-w-56 truncate">sent · {entry.text}</span>
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

        <div className="flex flex-col rounded-lg border border-border-subtle bg-surface-0 transition-colors overflow-hidden focus-within:border-text-4/40">
          <textarea
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder={sessionLive ? 'Steer Axom mid-flight...'
              : queuedBehind ? 'Message your Axom — queued behind the current turn'
              : 'Message your Axom — starts a turn'}
            rows={2}
            className="w-full resize-none field-sizing-content min-h-[72px] max-h-60 px-3 py-2.5 text-[13px] leading-[20px] bg-transparent font-sans text-text-0 placeholder:text-text-4 focus:outline-none"
          />
          <div className="flex items-center gap-1 px-1.5 pb-1.5 pt-0.5">
            {sessionLive && (
              <span className="flex items-center gap-2 pl-1.5 mr-auto">
                <span className="relative flex items-center justify-center w-3 h-3">
                  <span className="absolute inset-0 rounded-full bg-accent/30 animate-ping [animation-duration:2s]" />
                  <span className="relative w-2 h-2 rounded-full bg-accent" />
                </span>
                <span className="text-[10px] text-text-4 font-sans">turn in flight</span>
              </span>
            )}
            <div className="flex-1" />
            {sessionLive && (
              <button
                onClick={stop}
                disabled={!axomSelected || stopState === 'pending'}
                className="flex items-center gap-1.5 h-7 px-2 rounded-md text-[11px] font-medium text-text-3 hover:text-danger hover:bg-danger/10 disabled:opacity-40 disabled:pointer-events-none transition-colors cursor-pointer"
                title="Stop this turn"
              >
                <OctagonX size={13} /> Stop
              </button>
            )}
            <button
              onClick={send}
              disabled={!axomSelected || !text.trim() || sending}
              className={cn(
                'w-7 h-7 flex items-center justify-center rounded-md transition-colors cursor-pointer',
                'disabled:opacity-15 disabled:cursor-not-allowed',
                text.trim() ? 'text-text-0 hover:text-text-1' : 'text-text-4',
              )}
              title={sessionLive ? 'Steer (Enter)' : 'Send (Enter)'}
            >
              {sending ? <Loader2 size={15} className="animate-spin" />
                : sessionLive ? <Zap size={15} /> : <SendHorizontal size={15} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── View root — the workspace is home ──────────────────────────────────────
//
// The splash renders in exactly one case: no runtimes configured, ever.
// Once anything exists the tab always opens the workspace — stopped,
// unreachable, mid-crash, doesn't matter. The transcript stays visible and
// the input row is replaced by the state card carrying that state's one
// action. No state navigates; no state dead-ends.

export default function AxomView() {
  const axomStatus = useGrooveStore((s) => s.axomStatus);
  const axomSelected = useGrooveStore((s) => s.axomSelected);
  const axomEvents = useGrooveStore((s) => s.axomEvents);
  const axomPrompts = useGrooveStore((s) => s.axomPrompts);
  const axomAnomalies = useGrooveStore((s) => s.axomAnomalies);
  const axomStops = useGrooveStore((s) => s.axomStops);
  const runtimes = useGrooveStore((s) => s.axomRuntimes);
  const activeRuntimeId = useGrooveStore((s) => s.axomActiveRuntimeId);
  const fetchAxomRuntimes = useGrooveStore((s) => s.fetchAxomRuntimes);
  const runtimesLive = useGrooveStore((s) => s.axomRuntimesLive);
  const chats = useGrooveStore((s) => s.axomChats);
  const fetchAxomChats = useGrooveStore((s) => s.fetchAxomChats);
  const selectAxomSession = useGrooveStore((s) => s.selectAxomSession);
  const sendAxomStop = useGrooveStore((s) => s.sendAxomStop);
  const [highlight, setHighlight] = useState(null);
  const [managing, setManaging] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);

  useEffect(() => { fetchAxomRuntimes(); fetchAxomChats(); }, [fetchAxomRuntimes, fetchAxomChats]);

  // The daemon broadcasts `axom:runtimes` on every transition and verb, so
  // the poll exists only for daemons that predate those broadcasts. It
  // retires itself the moment the first one arrives — no redeploy, no
  // version check, and no stale view on an older daemon either.
  useEffect(() => {
    if (runtimesLive) return undefined;
    const t = setInterval(() => fetchAxomRuntimes(), 10000);
    return () => clearInterval(t);
  }, [fetchAxomRuntimes, runtimesLive]);

  // Safety net regardless of transport: a tab that was hidden while a runtime
  // died should be truthful the instant it's looked at again.
  useEffect(() => {
    function onFocus() { if (!document.hidden) fetchAxomRuntimes(); }
    document.addEventListener('visibilitychange', onFocus);
    window.addEventListener('focus', onFocus);
    return () => {
      document.removeEventListener('visibilitychange', onFocus);
      window.removeEventListener('focus', onFocus);
    };
  }, [fetchAxomRuntimes]);

  const runtime = useMemo(
    () => (runtimes || []).find((r) => r.id === activeRuntimeId) || (runtimes || [])[0] || null,
    [runtimes, activeRuntimeId],
  );
  // The connector keys endpoints by runtime id — that is the transcript's home.
  const endpoint = useMemo(
    () => (axomStatus?.endpoints || []).find((e) => e.name === runtime?.id) || null,
    [axomStatus, runtime],
  );

  // Auto-select a session so the tab is alive without a click.
  useEffect(() => {
    if (!endpoint || axomSelected?.endpoint === endpoint.name) return;
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

  // §10: hooks share one generation slot until multi-sequence lands. If the
  // slot is held by a session that ISN'T this one, this thread is queued and
  // must say so. Naming follows the prompt-ledger rule — name what we know,
  // stay honest where we don't: a hook we minted has a label, anything else
  // is "another session" rather than an invented name. A busy slot with no
  // resolvable holder is still queued: claiming free invites a send that
  // stalls with no explanation, which is the worse failure.
  const queuedBehind = useMemo(() => {
    if (!runtime?.generationBusy) return null;
    const holder = runtime.generationHolder || null;
    if (holder && holder === axomSelected?.session) return null; // our own turn
    return {
      session: holder,
      // The daemon names the holder when it's a chat we minted; anything else
      // was opened elsewhere and stays unnamed rather than invented.
      label: runtime.generationHolderLabel || 'another session',
    };
  }, [runtime, axomSelected]);

  // null means we haven't heard from the daemon yet. "Nothing configured" and
  // "we don't know yet" are different states and only one may show the splash.
  if (runtimes === null) {
    return (
      <div className="h-full flex items-center justify-center bg-surface-1">
        <Loader2 size={16} className="text-text-4 animate-spin" />
      </div>
    );
  }

  if (runtimes.length === 0) return <Onboarding />;

  const selectedSession = axomSelected
    && endpoint?.sessions.find((s) => s.session === axomSelected.session);
  // Liveness comes from the EVENT STREAM, not the daemon's session poll: the
  // poll only refreshes every 15s, so a turn that finished would keep the
  // thinking indicator running for seconds after the answer was already on
  // screen — the UI claiming work that had already stopped. In flight iff a
  // `pipeline_start` has arrived with no `pipeline_done` after it (§8: that
  // event is the sole terminal; nothing else may imply activity, and events
  // arriving after it are legal and must not revive the indicator).
  // NOT a hook — this sits below early returns, and a hook here throws #310.
  const sessionLive = (() => {
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i].kind === 'pipeline_done') return false;
      if (events[i].kind === 'pipeline_start') return true;
    }
    // No turn in this transcript yet: fall back to the daemon's view, which is
    // all we have for a session whose history predates this tab.
    return !!selectedSession?.live;
  })();
  // Only a connected runtime can take a message. Every other state gets the
  // card with its one verb — and keeps the transcript above it.
  const canChat = runtime?.state === 'connected' && !!axomSelected;

  return (
    <div className="h-full flex flex-col bg-surface-1 relative">
      <RuntimeHeader
        runtime={runtime}
        runtimes={runtimes}
        activeId={activeRuntimeId}
        endpoint={endpoint}
        anomalies={(sessionKeyStr && axomAnomalies[sessionKeyStr]) || []}
        onManage={() => setManaging(true)}
      />
      <div className="flex-1 flex min-h-0">
        <ChatSidebar
          runtime={runtime}
          chats={chats}
          holderSession={runtime?.generationBusy ? runtime.generationHolder : null}
          activityOpen={activityOpen}
          onShowActivity={() => setActivityOpen((v) => !v)}
        />
        <div className="flex-1 flex flex-col min-w-0 min-h-0">
          <WardrobeStrip about={runtime?.about || endpoint?.about} events={events} />
          <Conversation
            events={events}
            prompts={prompts}
            sessionLive={sessionLive}
            endpointName={runtime?.name || 'Axom'}
            highlight={highlight}
            onHighlight={setHighlight}
            queuedBehind={queuedBehind}
          />
          {answer && (
            <LivingAnswerPanel
              answer={answer}
              onStop={() => sendAxomStop().catch(() => {})}
              stopState={(sessionKeyStr && axomStops[sessionKeyStr]) || null}
              highlight={highlight}
              onHighlight={setHighlight}
            />
          )}
          {canChat
            ? <HotInput sessionLive={sessionLive} rollup={interruptRollup(events)} queuedBehind={queuedBehind} />
            : <RuntimeStateCard runtime={runtime} onManage={() => setManaging(true)} />}
        </div>
        {activityOpen && (
          <ActivityRail
            events={events}
            live={sessionLive}
            highlight={highlight}
            onHighlight={setHighlight}
            onClose={() => setActivityOpen(false)}
          />
        )}
      </div>

      {managing && (
        <RuntimeManager
          runtimes={runtimes}
          activeId={activeRuntimeId}
          onClose={() => setManaging(false)}
        />
      )}
    </div>
  );
}
