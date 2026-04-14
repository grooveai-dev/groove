// FSL-1.1-Apache-2.0 — see LICENSE
import { useState, useEffect } from 'react';
import { Dialog, DialogContent } from '../ui/dialog';
import { Button } from '../ui/button';
import { FolderBrowser } from '../agents/folder-browser';
import { useGrooveStore } from '../../stores/groove';
import { cn } from '../../lib/cn';
import { FolderSearch } from 'lucide-react';

export function ServerDialog({ open, onOpenChange, server, onSave }) {
  const [name, setName] = useState('');
  const [host, setHost] = useState('');
  const [user, setUser] = useState('');
  const [sshPort, setSshPort] = useState(22);
  const [sshKeyPath, setSshKeyPath] = useState('');
  const [autoStart, setAutoStart] = useState(false);
  const [autoConnect, setAutoConnect] = useState(false);
  const [keyBrowserOpen, setKeyBrowserOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      if (server) {
        setName(server.name || '');
        setHost(server.host || '');
        setUser(server.user || '');
        setSshPort(server.port || 22);
        setSshKeyPath(server.sshKeyPath || '');
        setAutoStart(server.autoStart || false);
        setAutoConnect(server.autoConnect || false);
      } else {
        setName('');
        setHost('');
        setUser('');
        setSshPort(22);
        setSshKeyPath('');
        setAutoStart(false);
        setAutoConnect(false);
      }
    }
  }, [open, server]);

  async function handleSave() {
    if (!name.trim() || !host.trim() || !user.trim()) return;
    setSaving(true);
    try {
      const data = {
        name: name.trim(),
        host: host.trim(),
        user: user.trim(),
        port: sshPort,
        sshKeyPath: sshKeyPath.trim(),
        autoStart,
        autoConnect,
      };
      if (server?.id) data.id = server.id;
      await onSave(data);
      onOpenChange(false);
    } catch (err) {
      useGrooveStore.getState().addToast('error', 'Failed to save server', err.message);
    }
    setSaving(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={server ? `Edit ${server.name}` : 'Add Remote Server'}
        description="Configure SSH connection to a remote server"
        className="max-w-[460px]"
      >
        <div className="px-5 py-4 space-y-4">
          {/* Name */}
          <div>
            <label className="text-2xs font-semibold text-text-2 font-sans mb-1.5 block">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="api-vps"
              className="w-full h-9 px-3 text-xs bg-surface-0 border border-border rounded-md text-text-0 font-sans placeholder:text-text-4 focus:outline-none focus:ring-1 focus:ring-accent"
              autoFocus
            />
          </div>

          {/* Host */}
          <div>
            <label className="text-2xs font-semibold text-text-2 font-sans mb-1.5 block">Host</label>
            <input
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="165.22.180.45 or hostname"
              className="w-full h-9 px-3 text-xs bg-surface-0 border border-border rounded-md text-text-0 font-mono placeholder:text-text-4 focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>

          {/* User + SSH Port */}
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-2xs font-semibold text-text-2 font-sans mb-1.5 block">User</label>
              <input
                value={user}
                onChange={(e) => setUser(e.target.value)}
                placeholder="root"
                className="w-full h-9 px-3 text-xs bg-surface-0 border border-border rounded-md text-text-0 font-mono placeholder:text-text-4 focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>
            <div className="w-24">
              <label className="text-2xs font-semibold text-text-2 font-sans mb-1.5 block">SSH Port</label>
              <input
                value={sshPort}
                onChange={(e) => setSshPort(Number(e.target.value) || 22)}
                type="number"
                className="w-full h-9 px-3 text-xs bg-surface-0 border border-border rounded-md text-text-0 font-mono placeholder:text-text-4 focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>
          </div>

          {/* SSH Key */}
          <div>
            <label className="text-2xs font-semibold text-text-2 font-sans mb-1.5 block">SSH Key</label>
            <div className="flex items-center gap-1.5">
              <input
                value={sshKeyPath}
                onChange={(e) => setSshKeyPath(e.target.value)}
                placeholder="~/.ssh/id_ed25519"
                className="flex-1 h-9 px-3 text-xs bg-surface-0 border border-border rounded-md text-text-0 font-mono placeholder:text-text-4 focus:outline-none focus:ring-1 focus:ring-accent"
              />
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setKeyBrowserOpen(true)}
                className="h-9 px-2.5 flex-shrink-0"
              >
                <FolderSearch size={13} />
              </Button>
            </div>
          </div>

          {/* Toggles */}
          <div className="space-y-3 pt-1">
            <label className="flex items-center justify-between cursor-pointer">
              <span className="text-xs text-text-2 font-sans">Auto-start daemon on connect</span>
              <ToggleSwitch value={autoStart} onChange={setAutoStart} />
            </label>
            <label className="flex items-center justify-between cursor-pointer">
              <span className="text-xs text-text-2 font-sans">Auto-connect on Groove launch</span>
              <ToggleSwitch value={autoConnect} onChange={setAutoConnect} />
            </label>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} className="h-8 text-xs px-4 text-text-3">
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleSave}
              disabled={!name.trim() || !host.trim() || !user.trim() || saving}
              className="h-8 text-xs px-4"
            >
              {saving ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </div>

        {/* File browser for SSH key */}
        <FolderBrowser
          open={keyBrowserOpen}
          onOpenChange={setKeyBrowserOpen}
          currentPath={sshKeyPath || '~/.ssh'}
          onSelect={(path) => setSshKeyPath(path)}
        />
      </DialogContent>
    </Dialog>
  );
}

function ToggleSwitch({ value, onChange }) {
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
