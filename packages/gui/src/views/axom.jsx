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
import { Atom, Zap, OctagonX, Plug, Radio, MessageSquareQuote, Shirt, TriangleAlert, Trophy, Download, Square, Play, Send, Plus, MemoryStick, HardDrive, Cpu, Gauge, CheckCircle2, Globe, Copy } from 'lucide-react';
import { motion } from 'framer-motion';
import { useGrooveStore } from '../stores/groove';
import { axomSessionKey } from '../stores/slices/axom-slice';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Badge } from '../components/ui/badge';
import { StatusDot } from '../components/ui/status-dot';
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

function Onboarding() {
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
      await saveAxomEndpoints([{ name: 'local', url: url.trim() }]);
    } catch (err) {
      addToast('error', 'Could not save endpoint', err.message);
    } finally {
      setSaving(false);
    }
  }

  const insufficient = hw?.verdict === 'insufficient';
  const ramPct = hw && req ? Math.min(100, (hw.totalRamGb / req.recommendedRamGb) * 100) : 0;

  return (
    <div className="h-full axom-hero-bg overflow-y-auto lg:overflow-hidden">
      <div className="min-h-full lg:h-full w-full max-w-[1600px] mx-auto px-6 xl:px-12 py-6 grid grid-cols-1 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)] gap-8 xl:gap-14 items-center">

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
            insufficient ? 'bg-surface-1/60 border-border-subtle' : 'axom-panel border-accent/25',
          )}>
            <span aria-hidden className={cn('absolute inset-x-0 top-0 h-px', insufficient ? 'axom-edge-muted' : 'axom-edge-accent')} />
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <span className={cn(
                  'flex h-7 w-7 items-center justify-center rounded-md border',
                  insufficient ? 'bg-surface-2 border-border-subtle text-text-4' : 'bg-accent/10 border-accent/25 text-accent',
                )}>
                  <Download size={14} strokeWidth={1.75} />
                </span>
                <span className={cn('text-sm font-semibold tracking-tight', insufficient ? 'text-text-3' : 'text-text-0')}>Run it here</span>
              </div>
              {!insufficient && hw && <Badge variant="accent">recommended here</Badge>}
            </div>
            <p className="text-xs text-text-3 leading-relaxed flex-1">
              One verified download — runtime and models (~{req?.downloadGb ?? 4.4} GB) —
              then your Axom lives on this machine, fully self-contained.
            </p>

            {insufficient ? (
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
              <Button variant="primary" size="lg" onClick={installLocally} disabled={!canInstall} className="w-full">
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
            insufficient ? 'axom-panel border-accent/25' : 'bg-surface-1/60 border-border-subtle',
          )}>
            <span aria-hidden className={cn('absolute inset-x-0 top-0 h-px', insufficient ? 'axom-edge-accent' : 'axom-edge-muted')} />
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <span className={cn(
                  'flex h-7 w-7 items-center justify-center rounded-md border',
                  insufficient ? 'bg-accent/10 border-accent/25 text-accent' : 'bg-surface-2 border-border-subtle text-text-3',
                )}>
                  <Globe size={14} strokeWidth={1.75} />
                </span>
                <span className="text-sm font-semibold tracking-tight text-text-0">Connect to an Axom</span>
              </div>
              {insufficient && <Badge variant="accent">recommended here</Badge>}
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
                <Button variant={insufficient ? 'primary' : 'secondary'} onClick={connect} disabled={saving || !url.trim()}>
                  <Plug size={14} className="mr-1.5" />
                  {saving ? 'Connecting…' : 'Connect'}
                </Button>
              </div>
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

function RuntimeHeader({ endpoint, anomalies }) {
  const addToast = useGrooveStore((s) => s.addToast);
  const about = endpoint.about;
  const dotStatus = endpoint.status === 'connected' ? 'running'
    : endpoint.status === 'connecting' ? 'starting' : 'crashed';
  return (
    <div className="flex-shrink-0 border-b border-border bg-surface-2 px-4 py-2.5 flex items-center gap-3 flex-wrap">
      <div className="flex items-center gap-2">
        <StatusDot status={dotStatus} size="sm" />
        <span className="text-sm font-semibold text-text-0">{endpoint.name}</span>
        <button
          onClick={() => { navigator.clipboard.writeText(endpoint.url); addToast('success', 'Endpoint copied'); }}
          className="text-xs text-text-4 font-mono hover:text-accent cursor-pointer"
          title="Copy endpoint URL"
        >
          {endpoint.url}
        </button>
      </div>
      {about?.family && <Badge variant="accent">{about.family}</Badge>}
      {about?.record?.benchmark && (
        <Badge>{about.record['pass@1']} {about.record.benchmark}</Badge>
      )}
      {about?.narrator && (
        <Badge className="font-mono">narrator: {about.narrator}</Badge>
      )}
      {endpoint.status === 'error' && (
        <span className="text-xs text-danger">{endpoint.error || 'unreachable'}</span>
      )}
      {(endpoint.drift?.novel?.length > 0 || endpoint.drift?.missing?.length > 0) && (
        <span className="text-xs text-warning" title={`novel: ${endpoint.drift.novel.join(', ') || '—'} · missing: ${endpoint.drift.missing.join(', ') || '—'}`}>
          schema drift: +{endpoint.drift.novel.length} / −{endpoint.drift.missing.length} kinds
        </span>
      )}
      {anomalies?.length > 0 && (
        <span
          className="flex items-center gap-1 text-xs text-warning"
          title={anomalies.slice(-3).map((a) => `${a.eventId}: ${a.message}`).join('\n')}
        >
          <TriangleAlert size={12} /> {anomalies.length} contract {anomalies.length === 1 ? 'anomaly' : 'anomalies'}
        </span>
      )}
    </div>
  );
}

// ── Session rail ────────────────────────────────────────────────────────────

function InstanceControls() {
  const instances = useGrooveStore((s) => s.axomInstances);
  const startAxomInstance = useGrooveStore((s) => s.startAxomInstance);
  const stopAxomInstance = useGrooveStore((s) => s.stopAxomInstance);
  const addToast = useGrooveStore((s) => s.addToast);
  if (instances.length === 0) return null;
  return (
    <div className="flex-shrink-0 border-t border-border px-3 py-2 flex flex-col gap-1">
      <div className="text-[11px] uppercase tracking-wide text-text-4 font-medium">Local instances</div>
      {instances.map((inst) => (
        <div key={inst.id} className="flex items-center gap-2 text-xs text-text-2">
          <StatusDot status={inst.status === 'running' ? 'running' : inst.status === 'error' ? 'crashed' : 'completed'} size="sm" />
          <span className="font-mono truncate" title={inst.error || inst.dataDir}>{inst.id}:{inst.port}</span>
          <button
            onClick={() => (inst.status === 'running'
              ? stopAxomInstance(inst.id)
              : startAxomInstance(inst.id)
            ).catch((err) => addToast('error', 'Instance action failed', err.message))}
            className="ml-auto text-text-3 hover:text-accent cursor-pointer"
            title={inst.status === 'running' ? 'Stop instance' : 'Start instance'}
          >
            {inst.status === 'running' ? <Square size={12} /> : <Play size={12} />}
          </button>
        </div>
      ))}
    </div>
  );
}

function SessionRail({ endpoint }) {
  const axomSelected = useGrooveStore((s) => s.axomSelected);
  const selectAxomSession = useGrooveStore((s) => s.selectAxomSession);
  return (
    <div className="w-52 flex-shrink-0 border-r border-border flex flex-col">
      <div className="px-3 py-2 flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wide text-text-4 font-medium">Sessions</span>
        {/* §12: session ids are caller-chosen; the first message creates it */}
        <button
          onClick={() => selectAxomSession(endpoint.name, `s-${Math.random().toString(36).slice(2, 10)}`)}
          className="text-text-3 hover:text-accent cursor-pointer"
          title="New session — created on your first message"
        >
          <Plus size={13} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {endpoint.sessions.length === 0 && (
          <p className="px-3 text-xs text-text-4">No sessions yet — start one from the Axom REPL or wait for the runtime to open one.</p>
        )}
        {endpoint.sessions.map((s) => (
          <button
            key={s.session}
            onClick={() => selectAxomSession(endpoint.name, s.session)}
            className={cn(
              'w-full text-left px-3 py-2 flex items-center gap-2 transition-colors cursor-pointer',
              axomSelected?.session === s.session ? 'bg-accent/10 text-text-0' : 'text-text-2 hover:bg-surface-2',
            )}
          >
            <StatusDot status={s.live ? 'running' : 'completed'} size="sm" />
            <span className="font-mono text-xs truncate">{s.session}</span>
            {s.overflow > 0 && (
              <span className="ml-auto text-[10px] text-warning" title={`${s.overflow} events evicted from the buffer`}>
                −{s.overflow}
              </span>
            )}
          </button>
        ))}
      </div>
      <InstanceControls />
    </div>
  );
}

// ── Raw ticker — every envelope, verbatim, nothing dropped ─────────────────

const KIND_TONE = {
  narration: 'text-accent',
  interrupt: 'text-warning', interrupt_ack: 'text-warning',
  stop_requested: 'text-danger', stop_effected: 'text-danger',
  pipeline_done: 'text-success', resolution: 'text-success',
  leaf_swap: 'text-accent',
};

function payloadPreview(payload) {
  if (payload == null) return '';
  if (typeof payload === 'string') return payload;
  const text = payload.text || payload.thought || payload.content;
  if (typeof text === 'string') return text;
  try { return JSON.stringify(payload); } catch { return String(payload); }
}

function RawTicker({ events, highlight }) {
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
    const el = scrollRef.current?.querySelector(`[data-ev="${highlight.ids[0]}"]`);
    if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [highlight]);

  function onScroll() {
    const el = scrollRef.current;
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  }

  const cited = new Set(highlight?.ids || []);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-3 py-2 flex items-center gap-2 text-[11px] uppercase tracking-wide text-text-4 font-medium">
        <Radio size={12} /> Event ticker
        <span className="normal-case font-normal tracking-normal">— {events.length} buffered</span>
      </div>
      <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto px-3 pb-2 font-mono text-xs leading-5">
        {events.length === 0 && (
          <p className="text-text-4 font-sans">Waiting for events…</p>
        )}
        {events.map((e) => (
          <div
            key={e.id}
            data-ev={e.id}
            className={cn(
              'flex gap-2 items-baseline rounded px-1 -mx-1 transition-colors',
              cited.has(e.id) ? 'bg-accent/15 outline outline-1 outline-accent/40' : 'hover:bg-surface-2',
            )}
          >
            <span className="text-text-4 flex-shrink-0">{e.id}</span>
            <span className={cn('flex-shrink-0', KIND_TONE[e.kind] || 'text-text-2')}>{e.kind}</span>
            {e.step != null && <span className="text-text-4 flex-shrink-0">s{e.step}</span>}
            <span className="text-text-3 truncate">{payloadPreview(e.payload)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Narrated stream — telemetry-grounded or absent ─────────────────────────
//
// Renders `narration` events ONLY when they carry citations; an uncited
// narration renders nothing (law 1). Clicking a narration highlights its
// cited events in the ticker (law 4 — provenance as interaction).

// §9: narration.payload = {text, cites: [ev-ids]} — `cites` is the field,
// no variant exists.
function narrationCites(payload) {
  const cites = payload?.cites;
  return Array.isArray(cites) ? cites.filter((c) => typeof c === 'string') : [];
}

function NarratedStream({ events, highlight, onHighlight }) {
  const scrollRef = useRef(null);
  const pinnedRef = useRef(true);
  const narrations = useMemo(
    () => events
      .filter((e) => e.kind === 'narration')
      .map((e) => ({ ...e, cites: narrationCites(e.payload) }))
      .filter((e) => e.cites.length > 0),
    [events],
  );

  useEffect(() => {
    const el = scrollRef.current;
    if (el && pinnedRef.current) el.scrollTop = el.scrollHeight;
  }, [narrations.length]);

  function onScroll() {
    const el = scrollRef.current;
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 border-r border-border">
      <div className="px-3 py-2 flex items-center gap-2 text-[11px] uppercase tracking-wide text-text-4 font-medium">
        <MessageSquareQuote size={12} /> Narrated
        <span className="normal-case font-normal tracking-normal">— every line cited</span>
      </div>
      <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto px-3 pb-2 flex flex-col gap-1.5">
        {narrations.length === 0 && (
          <p className="text-xs text-text-4">
            No narration yet. Lines appear here only when the narrator cites the
            events behind them — silence means nothing narratable has happened.
          </p>
        )}
        {narrations.map((n) => (
          <button
            key={n.id}
            onClick={() => onHighlight(highlight?.narrationId === n.id ? null : { narrationId: n.id, ids: n.cites })}
            className={cn(
              'text-left text-sm leading-relaxed rounded-md px-2.5 py-1.5 border transition-colors cursor-pointer',
              highlight?.narrationId === n.id
                ? 'bg-accent/10 border-accent/30 text-text-0'
                : 'bg-surface-2 border-transparent text-text-1 hover:border-border',
            )}
          >
            {payloadPreview(n.payload)}
            <span className="block mt-0.5 font-mono text-[10px] text-text-4">
              cites {n.cites.join(' ')}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Wardrobe history strip (§7) — the leaf timeline, never guessed ─────────

// §9: leaf_swap.payload = {from: str|null, to: str, firing_id} — the worn
// leaf is `to` (`from` is null on a firing's first swap).
function leafOf(payload) {
  return typeof payload?.to === 'string' ? payload.to : null;
}

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
    <div className="flex-shrink-0 border-b border-border px-4 py-1.5 flex items-center gap-2 overflow-x-auto">
      <Shirt size={12} className="text-text-4 flex-shrink-0" />
      <span className="text-[10px] uppercase tracking-wide text-text-4 font-medium flex-shrink-0">Wardrobe</span>
      <Badge variant={current === 'UNKNOWN' ? 'default' : 'accent'}>{current}</Badge>
      {swaps.length > 1 && (
        <span className="font-mono text-[10px] text-text-4 whitespace-nowrap" title="Leaf swap history — each entry is a leaf_swap event">
          {swaps.slice(-8).map((s, i) => (
            <span key={s.id} title={s.id}>
              {i > 0 && ' → '}
              {s.leaf ?? '?'}
            </span>
          ))}
        </span>
      )}
      <span className="ml-auto text-[10px] text-text-4 whitespace-nowrap flex-shrink-0">
        roster: {roster.length ? roster.map((l) => l.name).join(' · ') : '—'}
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

const WATERMARK_BADGE = {
  PROVISIONAL: { variant: 'warning', dot: 'pulse' },
  SETTLED: { variant: 'success', dot: true },
  STOPPED: { variant: 'danger', dot: true },
};

// A provenance-bearing block: clicking highlights its basis events in the
// ticker, exactly like narration cites.
function BasisButton({ basis, highlightKey, highlight, onHighlight, className, children, title }) {
  const active = highlight?.narrationId === highlightKey;
  return (
    <button
      title={title}
      onClick={() => basis.length && onHighlight(active ? null : { narrationId: highlightKey, ids: basis })}
      className={cn(
        'text-left rounded-md border transition-colors',
        basis.length ? 'cursor-pointer' : 'cursor-default',
        active ? 'bg-accent/10 border-accent/30' : 'border-transparent hover:border-border',
        className,
      )}
    >
      {children}
    </button>
  );
}

function LivingAnswerPanel({ answer, onStop, stopState, highlight, onHighlight }) {
  const badge = WATERMARK_BADGE[answer.watermark];
  const champion = answer.champion ? answer.byFiring[answer.champion.to] : null;
  const conf = answer.confidence;
  return (
    <div className="flex-shrink-0 border-b border-border bg-surface-2 px-4 py-2 flex flex-col gap-1.5 max-h-56 overflow-y-auto">
      <div className="flex items-center gap-3 flex-wrap">
        <Trophy size={13} className="text-text-3 flex-shrink-0" />
        <span className="text-xs font-semibold text-text-1">Living Answer</span>
        <Badge variant={badge.variant} dot={badge.dot}>{answer.watermark}</Badge>
        <span className="text-xs text-text-3">
          {answer.candidates.length} candidate{answer.candidates.length === 1 ? '' : 's'}
          {answer.banked > 0 && <> · {answer.banked} banked</>}
        </span>
        {answer.watermark === 'PROVISIONAL' && (
          <Button size="sm" variant="danger" onClick={onStop} disabled={stopState === 'pending'} className="ml-auto">
            <OctagonX size={12} className="mr-1" /> Good enough — stop
          </Button>
        )}
      </div>

      {answer.champion && (
        <BasisButton
          basis={answer.champion.basis}
          highlightKey="champion"
          highlight={highlight}
          onHighlight={onHighlight}
          className="px-2.5 py-1.5 bg-surface-1"
          title={answer.champion.basis.length ? 'Click to highlight the events behind this champion' : undefined}
        >
          <span className="flex items-center gap-2 mb-0.5">
            {champion?.leafId && <Badge variant="accent">{champion.leafId}</Badge>}
            {answer.champion.rule && (
              <span className="font-mono text-[10px] text-text-4">rule: {answer.champion.rule}</span>
            )}
          </span>
          {typeof champion?.text === 'string' && (
            <span className="block text-sm text-text-1 leading-relaxed whitespace-pre-wrap">
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
          className="px-2.5 py-1 text-xs text-text-3"
        >
          {[
            conf.candidates != null && `${conf.candidates} candidates`,
            conf.n_fused != null && conf.n_agents != null && `${conf.n_fused}/${conf.n_agents} fused`,
            conf.n_facts != null && `${conf.n_facts} facts`,
            conf.tools_grounded != null && `tools ${String(conf.tools_grounded)}`,
          ].filter(Boolean).join(' · ')}
          {/* §10: the U3 meter waiting for its organ — dimmed, never invented */}
          <span className="text-text-4 opacity-60"> · verifier: {conf.verifier == null ? 'awaiting integration' : String(conf.verifier)}</span>
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
              className="px-1.5 py-0.5 bg-surface-1 font-mono text-[10px] text-text-3"
              title={ev.values ? JSON.stringify(ev.values) : undefined}
            >
              {ev.source ?? 'evidence'}
            </BasisButton>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Hot input + interrupt/stop accountability ──────────────────────────────

const INTERRUPT_CHIP = {
  sent: { label: 'sent', className: 'bg-surface-2 text-text-3 border-border' },
  heard: { label: '⚡ heard', className: 'bg-warning/10 text-warning border-warning/30' },
  acked: { label: 'acked', className: 'bg-success/10 text-success border-success/30' },
};

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

const ROLLUP_TONE = { acked: 'text-success', unanswered: 'text-warning', unconsumed: 'text-danger' };

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
      addToast('error', sessionLive ? 'Interrupt failed' : 'Message failed', err.message);
      setText(message);
    }
  }

  async function stop() {
    try { await sendAxomStop(); } catch (err) { addToast('error', 'Stop failed', err.message); }
  }

  const chips = Object.entries(ledger).slice(-6);

  return (
    <div className="flex-shrink-0 border-t border-border bg-surface-2 px-3 py-2 flex flex-col gap-2">
      {(chips.length > 0 || stopState || rollup) && (
        <div className="flex items-center gap-1.5 flex-wrap">
          {chips.map(([id, entry]) => {
            const chip = INTERRUPT_CHIP[entry.state] || INTERRUPT_CHIP.sent;
            return (
              <span
                key={id}
                title={entry.text}
                className={cn('px-1.5 py-0.5 rounded border text-[10px] font-medium max-w-48 truncate', chip.className)}
              >
                {chip.label} · {entry.text}
              </span>
            );
          })}
          {stopState && (
            <span className="px-1.5 py-0.5 rounded border border-danger/30 bg-danger/10 text-danger text-[10px] font-medium">
              {STOP_LABEL[stopState]}
            </span>
          )}
          {rollup && (
            <span className="ml-auto text-[10px] text-text-4" title="Interrupt accounting from the last pipeline_done rollup — every interrupt ends in exactly one state">
              run rollup:{' '}
              {Object.entries(rollup).map(([state, count], i) => (
                <span key={state}>
                  {i > 0 && ' · '}
                  <span className={ROLLUP_TONE[state]}>{count} {state}</span>
                </span>
              ))}
            </span>
          )}
        </div>
      )}
      <div className="flex gap-2">
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder={sessionLive ? 'Type to steer Axom mid-flight…' : 'Message your Axom — starts a turn'}
          className="flex-1 text-sm"
        />
        <Button variant="secondary" onClick={send} disabled={!axomSelected || !text.trim()}>
          {sessionLive ? <><Zap size={14} className="mr-1" /> Steer</> : <><Send size={14} className="mr-1" /> Send</>}
        </Button>
        <Button
          variant="danger"
          onClick={stop}
          disabled={!axomSelected || stopState === 'pending'}
        >
          <OctagonX size={14} className="mr-1" /> Stop
        </Button>
      </div>
    </div>
  );
}

// ── View root ───────────────────────────────────────────────────────────────

export default function AxomView() {
  const axomStatus = useGrooveStore((s) => s.axomStatus);
  const axomSelected = useGrooveStore((s) => s.axomSelected);
  const axomEvents = useGrooveStore((s) => s.axomEvents);
  const axomAnomalies = useGrooveStore((s) => s.axomAnomalies);
  const axomStops = useGrooveStore((s) => s.axomStops);
  const selectAxomSession = useGrooveStore((s) => s.selectAxomSession);
  const sendAxomStop = useGrooveStore((s) => s.sendAxomStop);
  const [highlight, setHighlight] = useState(null);

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

  // A highlight belongs to one session's stream — drop it on switch.
  useEffect(() => { setHighlight(null); }, [sessionKeyStr]);

  const answer = useMemo(() => livingAnswer(events), [events]);

  if (!endpoint) return <Onboarding />;

  const selectedSession = axomSelected
    && endpoint.sessions.find((s) => s.session === axomSelected.session);

  return (
    <div className="h-full flex flex-col bg-surface-1">
      <RuntimeHeader endpoint={endpoint} anomalies={(sessionKeyStr && axomAnomalies[sessionKeyStr]) || []} />
      <div className="flex-1 flex min-h-0">
        <SessionRail endpoint={endpoint} />
        <div className="flex-1 flex flex-col min-w-0 min-h-0">
          <WardrobeStrip about={endpoint.about} events={events} />
          {answer && (
            <LivingAnswerPanel
              answer={answer}
              onStop={() => sendAxomStop().catch(() => {})}
              stopState={(sessionKeyStr && axomStops[sessionKeyStr]) || null}
              highlight={highlight}
              onHighlight={setHighlight}
            />
          )}
          <div className="flex-1 flex min-h-0">
            <NarratedStream events={events} highlight={highlight} onHighlight={setHighlight} />
            <RawTicker events={events} highlight={highlight} />
          </div>
          <HotInput sessionLive={!!selectedSession?.live} rollup={interruptRollup(events)} />
        </div>
      </div>
    </div>
  );
}
