// FSL-1.1-Apache-2.0 — see LICENSE
import { useState, useEffect } from 'react';
import { RotateCw, Skull, Copy, Play, Trash2, FolderOpen, Cpu, ChevronDown, Zap, Shield, FileText } from 'lucide-react';
import { useGrooveStore } from '../../stores/groove';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { api } from '../../lib/api';
import { cn } from '../../lib/cn';

export function AgentActions({ agent }) {
  const killAgent = useGrooveStore((s) => s.killAgent);
  const rotateAgent = useGrooveStore((s) => s.rotateAgent);
  const spawnAgent = useGrooveStore((s) => s.spawnAgent);
  const closeDetail = useGrooveStore((s) => s.closeDetail);
  const addToast = useGrooveStore((s) => s.addToast);

  const [confirmKill, setConfirmKill] = useState(false);
  const [loading, setLoading] = useState(null);
  const [providers, setProviders] = useState([]);
  const [selectedModel, setSelectedModel] = useState(agent.model || '');
  const [editPrompt, setEditPrompt] = useState('');
  const [showPromptEdit, setShowPromptEdit] = useState(false);

  const isAlive = agent.status === 'running' || agent.status === 'starting';

  useEffect(() => {
    api.get('/providers').then((data) => setProviders(Array.isArray(data) ? data : [])).catch(() => {});
  }, []);

  const currentProvider = providers.find((p) => p.id === agent.provider);
  const models = currentProvider?.models || [];

  async function handleRotate() {
    setLoading('rotate');
    try { await rotateAgent(agent.id); } catch {}
    setLoading(null);
  }

  async function handleKill() {
    if (!confirmKill) { setConfirmKill(true); return; }
    setLoading('kill');
    try { await killAgent(agent.id); closeDetail(); } catch {}
    setLoading(null);
    setConfirmKill(false);
  }

  async function handleClone() {
    setLoading('clone');
    try {
      await spawnAgent({
        role: agent.role, provider: agent.provider, model: agent.model,
        name: `${agent.name}-clone`, scope: agent.scope, workingDir: agent.workingDir,
      });
    } catch {}
    setLoading(null);
  }

  async function handleRestart() {
    setLoading('restart');
    try {
      await spawnAgent({
        role: agent.role, provider: agent.provider, model: agent.model,
        name: agent.name, scope: agent.scope, workingDir: agent.workingDir, prompt: agent.prompt,
      });
    } catch {}
    setLoading(null);
  }

  async function handleModelSwap(newModel) {
    setSelectedModel(newModel);
    try {
      await api.patch(`/agents/${agent.id}`, { model: newModel });
      addToast('success', `Model changed to ${newModel}`);
    } catch (err) {
      addToast('error', 'Model swap failed', err.message);
    }
  }

  async function handleSendPrompt() {
    if (!editPrompt.trim()) return;
    setLoading('prompt');
    try {
      const instructAgent = useGrooveStore.getState().instructAgent;
      await instructAgent(agent.id, editPrompt.trim());
      setEditPrompt('');
      setShowPromptEdit(false);
    } catch {}
    setLoading(null);
  }

  return (
    <div className="px-5 py-4 space-y-5">
      {/* ── Quick Actions ───────────────────────────────── */}
      <div>
        <span className="text-2xs font-semibold text-text-3 font-sans uppercase tracking-wider block mb-3">Quick Actions</span>
        <div className="grid grid-cols-2 gap-2">
          {isAlive && (
            <Button variant="secondary" size="sm" onClick={handleRotate} disabled={loading === 'rotate'} className="justify-start gap-2">
              <RotateCw size={14} className={loading === 'rotate' ? 'animate-spin' : ''} />
              Rotate Context
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={handleClone} disabled={!!loading} className="justify-start gap-2">
            <Copy size={14} /> Clone
          </Button>
          {!isAlive && (
            <Button variant="secondary" size="sm" onClick={handleRestart} disabled={!!loading} className="justify-start gap-2">
              <Play size={14} /> Restart
            </Button>
          )}
        </div>
      </div>

      {/* ── Model Selection ─────────────────────────────── */}
      {isAlive && currentProvider && (
        <div>
          <span className="text-2xs font-semibold text-text-3 font-sans uppercase tracking-wider block mb-2">
            <Cpu size={10} className="inline mr-1" /> Model
          </span>
          <div className="relative">
            <select
              value={selectedModel}
              onChange={(e) => handleModelSwap(e.target.value)}
              className="w-full h-9 px-3 pr-8 text-sm rounded-lg bg-surface-0 border border-border text-text-0 font-mono appearance-none cursor-pointer focus:outline-none focus:ring-1 focus:ring-accent"
            >
              {models.map((m) => (
                <option key={m.id} value={m.id}>{m.name} ({m.tier})</option>
              ))}
            </select>
            <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-3 pointer-events-none" />
          </div>
          {currentProvider.canHotSwap && (
            <span className="text-2xs text-accent font-sans mt-1 inline-flex items-center gap-1">
              <Zap size={10} /> Hot-swap enabled
            </span>
          )}
        </div>
      )}

      {/* ── Working Directory ───────────────────────────── */}
      <div>
        <span className="text-2xs font-semibold text-text-3 font-sans uppercase tracking-wider block mb-2">
          <FolderOpen size={10} className="inline mr-1" /> Working Directory
        </span>
        <div className="bg-surface-0 rounded-lg px-3 py-2 text-xs font-mono text-text-1 border border-border-subtle">
          {agent.workingDir || 'Project root'}
        </div>
      </div>

      {/* ── Scope ───────────────────────────────────────── */}
      {agent.scope?.length > 0 && (
        <div>
          <span className="text-2xs font-semibold text-text-3 font-sans uppercase tracking-wider block mb-2">
            <Shield size={10} className="inline mr-1" /> File Scope
          </span>
          <div className="flex flex-wrap gap-1.5">
            {(Array.isArray(agent.scope) ? agent.scope : [agent.scope]).map((s, i) => (
              <Badge key={i} variant="default" className="font-mono text-2xs">{s}</Badge>
            ))}
          </div>
        </div>
      )}

      {/* ── Send Instruction ────────────────────────────── */}
      {isAlive && (
        <div>
          <span className="text-2xs font-semibold text-text-3 font-sans uppercase tracking-wider block mb-2">
            <FileText size={10} className="inline mr-1" /> Quick Instruction
          </span>
          <textarea
            value={editPrompt}
            onChange={(e) => setEditPrompt(e.target.value)}
            placeholder="Send a quick instruction..."
            rows={2}
            className="w-full rounded-lg px-3 py-2 text-xs bg-surface-0 border border-border text-text-0 font-sans placeholder:text-text-4 focus:outline-none focus:ring-1 focus:ring-accent resize-none"
          />
          <Button variant="primary" size="sm" onClick={handleSendPrompt} disabled={!editPrompt.trim() || loading === 'prompt'} className="mt-2 w-full">
            Send Instruction
          </Button>
        </div>
      )}

      {/* ── Current Config ──────────────────────────────── */}
      <div>
        <span className="text-2xs font-semibold text-text-3 font-sans uppercase tracking-wider block mb-2">Configuration</span>
        <div className="bg-surface-0 rounded-lg px-3 py-1 text-2xs font-mono text-text-3 space-y-0.5 max-h-28 overflow-y-auto">
          <div>id: <span className="text-text-2">{agent.id}</span></div>
          <div>role: <span className="text-text-2">{agent.role}</span></div>
          <div>provider: <span className="text-text-2">{agent.provider}</span></div>
          <div>model: <span className="text-text-2">{agent.model || 'auto'}</span></div>
          <div>status: <span className="text-text-2">{agent.status}</span></div>
          {agent.permission && <div>permission: <span className="text-text-2">{agent.permission}</span></div>}
        </div>
      </div>

      {/* ── Danger Zone ─────────────────────────────────── */}
      <div className="pt-3 border-t border-border-subtle">
        <span className="text-2xs font-semibold text-danger/60 font-sans uppercase tracking-wider block mb-2">Danger Zone</span>
        {isAlive ? (
          <Button variant="danger" size="sm" onClick={handleKill} disabled={loading === 'kill'} className="w-full">
            <Skull size={14} />
            {confirmKill ? 'Click again to confirm kill' : 'Kill Agent'}
          </Button>
        ) : (
          <Button variant="danger" size="sm" onClick={() => { killAgent(agent.id, true); closeDetail(); }} className="w-full">
            <Trash2 size={14} /> Remove Agent
          </Button>
        )}
      </div>
    </div>
  );
}
