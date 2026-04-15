// FSL-1.1-Apache-2.0 — see LICENSE
import { useState } from 'react';
import { useGrooveStore } from '../../stores/groove';
import { Dialog, DialogContent } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Badge } from '../ui/badge';
import { StatusDot } from '../ui/status-dot';
import { cn } from '../../lib/cn';
import {
  Link2, Loader2, Check, Server, ArrowRight, Wifi, AlertCircle,
} from 'lucide-react';

const STEPS = [
  { label: 'Connect', icon: Link2 },
  { label: 'Verify', icon: Server },
  { label: 'Paired', icon: Check },
];

function StepIndicator({ current }) {
  return (
    <div className="flex items-center justify-center gap-2 mb-6">
      {STEPS.map((step, i) => {
        const done = i < current;
        const active = i === current;
        const Icon = step.icon;
        return (
          <div key={step.label} className="flex items-center gap-2">
            {i > 0 && (
              <div className={cn(
                'w-8 h-px',
                done ? 'bg-accent' : 'bg-border-subtle',
              )} />
            )}
            <div className="flex items-center gap-1.5">
              <div className={cn(
                'w-6 h-6 rounded-full flex items-center justify-center transition-colors',
                done ? 'bg-accent text-white' : active ? 'bg-accent/15 text-accent border border-accent/30' : 'bg-surface-3 text-text-4',
              )}>
                {done ? <Check size={12} /> : <Icon size={12} />}
              </div>
              <span className={cn(
                'text-2xs font-semibold font-sans',
                active ? 'text-text-0' : done ? 'text-accent' : 'text-text-4',
              )}>
                {step.label}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function FederationWizard({ open, onOpenChange }) {
  const addToWhitelist = useGrooveStore((s) => s.addToWhitelist);
  const fetchFederationStatus = useGrooveStore((s) => s.fetchFederationStatus);

  const [step, setStep] = useState(0);
  const [ip, setIp] = useState('');
  const [port, setPort] = useState('31415');
  const [name, setName] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [pairing, setPairing] = useState(false);
  const [error, setError] = useState(null);
  const [remoteInfo, setRemoteInfo] = useState(null);

  function reset() {
    setStep(0);
    setIp('');
    setPort('31415');
    setName('');
    setTesting(false);
    setTestResult(null);
    setPairing(false);
    setError(null);
    setRemoteInfo(null);
  }

  function handleOpenChange(open) {
    if (!open) reset();
    onOpenChange(open);
  }

  async function testReachability() {
    setTesting(true);
    setTestResult(null);
    setError(null);
    try {
      const target = `${ip.trim()}:${port || '31415'}`;
      const res = await fetch(`http://localhost:31415/api/federation/test?target=${encodeURIComponent(target)}`);
      if (res.ok) {
        const data = await res.json();
        setTestResult('reachable');
        setRemoteInfo(data);
      } else {
        setTestResult('unreachable');
      }
    } catch {
      setTestResult('unreachable');
    }
    setTesting(false);
  }

  async function handlePair() {
    setPairing(true);
    setError(null);
    try {
      await addToWhitelist(ip.trim(), parseInt(port, 10) || 31415, name.trim() || undefined);
      await fetchFederationStatus();
      setStep(2);
    } catch (err) {
      setError(err.message || 'Failed to pair with peer');
    }
    setPairing(false);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent title="Pair New Peer" description="Connect to a remote Groove daemon">
        <div className="px-5 py-5">
          <StepIndicator current={step} />

          {step === 0 && (
            <div className="space-y-4">
              <Input
                label="Friendly Name"
                placeholder="e.g. Production Server"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <div className="grid grid-cols-[1fr,100px] gap-2">
                <Input
                  label="IP / Hostname"
                  placeholder="192.168.1.100"
                  value={ip}
                  onChange={(e) => setIp(e.target.value)}
                  mono
                />
                <Input
                  label="Port"
                  placeholder="31415"
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                  mono
                />
              </div>

              {testResult === 'reachable' && (
                <div className="flex items-center gap-2 rounded-md bg-success/10 border border-success/20 px-3 py-2">
                  <Wifi size={13} className="text-success" />
                  <span className="text-2xs text-success font-sans font-medium">Peer is reachable</span>
                </div>
              )}
              {testResult === 'unreachable' && (
                <div className="flex items-center gap-2 rounded-md bg-danger/10 border border-danger/20 px-3 py-2">
                  <AlertCircle size={13} className="text-danger" />
                  <span className="text-2xs text-danger font-sans font-medium">Could not reach peer — check IP and port</span>
                </div>
              )}

              <div className="flex items-center gap-2 pt-2">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!ip.trim() || testing}
                  onClick={testReachability}
                  className="h-8 text-xs gap-1.5"
                >
                  {testing ? <Loader2 size={12} className="animate-spin" /> : <Wifi size={12} />}
                  Test Reachability
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  disabled={!ip.trim()}
                  onClick={() => setStep(1)}
                  className="h-8 text-xs gap-1.5 ml-auto"
                >
                  Continue
                  <ArrowRight size={12} />
                </Button>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <div className="rounded-md border border-border-subtle bg-surface-0 p-4">
                <div className="flex items-center gap-3 mb-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-md bg-accent/10">
                    <Server size={16} className="text-accent" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-text-0 font-sans">{name || 'Remote Peer'}</p>
                    <p className="text-2xs text-text-3 font-mono">{ip}:{port || '31415'}</p>
                  </div>
                </div>

                {remoteInfo && (
                  <div className="space-y-1.5 pt-2 border-t border-border-subtle">
                    {remoteInfo.version && (
                      <div className="flex items-center justify-between text-2xs font-sans">
                        <span className="text-text-3">Version</span>
                        <span className="text-text-1 font-mono">{remoteInfo.version}</span>
                      </div>
                    )}
                    {remoteInfo.peerId && (
                      <div className="flex items-center justify-between text-2xs font-sans">
                        <span className="text-text-3">Peer ID</span>
                        <span className="text-text-1 font-mono truncate max-w-40">{remoteInfo.peerId}</span>
                      </div>
                    )}
                    {remoteInfo.agents != null && (
                      <div className="flex items-center justify-between text-2xs font-sans">
                        <span className="text-text-3">Active Agents</span>
                        <span className="text-text-1">{remoteInfo.agents}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {error && (
                <div className="flex items-center gap-2 rounded-md bg-danger/10 border border-danger/20 px-3 py-2">
                  <AlertCircle size={13} className="text-danger" />
                  <span className="text-2xs text-danger font-sans">{error}</span>
                </div>
              )}

              <div className="flex items-center gap-2 pt-2">
                <Button size="sm" variant="ghost" onClick={() => setStep(0)} className="h-8 text-xs">
                  Back
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  disabled={pairing}
                  onClick={handlePair}
                  className="h-8 text-xs gap-1.5 ml-auto"
                >
                  {pairing ? <Loader2 size={12} className="animate-spin" /> : <Link2 size={12} />}
                  Confirm Pairing
                </Button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="text-center space-y-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-success/15 mx-auto">
                <Check size={20} className="text-success" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-text-0 font-sans mb-1">Peer Paired Successfully</h3>
                <p className="text-2xs text-text-3 font-sans">
                  {name || ip} has been added to your federation whitelist.
                </p>
              </div>

              <div className="rounded-md border border-border-subtle bg-surface-0 p-3 text-left">
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-md bg-accent/10">
                    <Server size={14} className="text-accent" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-xs font-semibold text-text-0 font-sans block truncate">{name || 'Remote Peer'}</span>
                    <span className="text-2xs text-text-3 font-mono">{ip}:{port || '31415'}</span>
                  </div>
                  <Badge variant="success" className="text-2xs gap-1">
                    <StatusDot status="running" size="sm" />
                    Whitelisted
                  </Badge>
                </div>
              </div>

              <Button
                size="sm"
                variant="primary"
                onClick={() => handleOpenChange(false)}
                className="h-8 text-xs"
              >
                Done
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
