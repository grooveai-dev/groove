// FSL-1.1-Apache-2.0 — see LICENSE
import { memo } from 'react';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Wallet, Cpu, Activity, Clock, Zap } from 'lucide-react';

const REWARD_CARDS = [
  { icon: Cpu, label: 'Compute Hours', value: '—' },
  { icon: Activity, label: 'Sessions Served', value: '—' },
  { icon: Clock, label: 'Uptime Score', value: '—' },
  { icon: Zap, label: 'Network Score', value: '—' },
];

const PAYOUT_COLS = ['Date', 'Amount', 'Status', 'TX'];

export const WalletView = memo(function WalletView() {
  return (
    <div className="flex flex-col h-full overflow-auto">
      {/* Hero */}
      <div className="px-6 py-8 text-center border-b border-border-subtle bg-surface-0">
        <div className="text-3xl font-mono font-semibold text-text-0 tabular-nums">0.00</div>
        <div className="text-sm font-mono text-text-3 mt-1">GROOVE</div>
        <Badge variant="purple" className="mt-3">Base L2</Badge>
        <div className="mt-4">
          <Button variant="primary" size="md" className="gap-2" disabled>
            <Wallet size={14} />
            Connect Wallet
          </Button>
        </div>
        <div className="text-2xs text-text-4 mt-2">Connect your Base wallet to claim rewards</div>
      </div>

      {/* Reward Metrics */}
      <div className="px-4 py-4">
        <div className="text-2xs font-mono text-text-3 uppercase tracking-widest mb-3">EARNING POTENTIAL</div>
        <div className="grid grid-cols-4 gap-2">
          {REWARD_CARDS.map((card) => (
            <div key={card.label} className="rounded-md border border-border-subtle bg-surface-1 px-3 py-3 text-center">
              <card.icon size={16} className="text-text-3 mx-auto mb-1.5" />
              <div className="text-lg font-mono text-text-0 tabular-nums">{card.value}</div>
              <div className="text-2xs text-text-4 mt-0.5">{card.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Earnings Timeline */}
      <div className="px-4 py-4 border-t border-border-subtle">
        <div className="text-2xs font-mono text-text-3 uppercase tracking-widest mb-3">EARNINGS HISTORY</div>
        <div className="h-40 rounded-md border border-border-subtle bg-surface-0 flex items-center justify-center">
          <span className="text-xs font-mono text-text-4">Earnings data will appear here</span>
        </div>
      </div>

      {/* Payouts Table */}
      <div className="px-4 py-4 border-t border-border-subtle">
        <div className="text-2xs font-mono text-text-3 uppercase tracking-widest mb-3">PAYOUT HISTORY</div>
        <div className="grid grid-cols-4 px-3 py-1.5 text-2xs font-mono text-text-4 uppercase tracking-wider">
          {PAYOUT_COLS.map((col) => (
            <span key={col}>{col}</span>
          ))}
        </div>
        <div className="px-3 py-6 text-center text-xs font-mono text-text-4">No payouts yet</div>
      </div>

      {/* Banner */}
      <div className="px-4 pb-6">
        <div className="rounded-md border border-purple/20 bg-purple/5 px-4 py-3 flex items-center gap-3">
          <Zap size={16} className="text-purple flex-shrink-0" />
          <span className="text-xs font-sans text-text-2">
            Rewards go live when the GROOVE token launches on Base. Keep your node running to accumulate compute credits.
          </span>
        </div>
      </div>
    </div>
  );
});
