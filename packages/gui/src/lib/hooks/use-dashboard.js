// FSL-1.1-Apache-2.0 — see LICENSE
import { useState, useEffect, useRef } from 'react';
import { useGrooveStore } from '../../stores/groove';
import { api } from '../api';

export function useDashboard() {
  const connected = useGrooveStore((s) => s.connected);
  const agents = useGrooveStore((s) => s.agents);

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [kpiHistory, setKpiHistory] = useState({
    tokens: [], cost: [], saved: [], efficiency: [],
    cache: [], inputOutput: [], agents: [], turns: [],
  });
  const lastFetch = useRef(0);

  useEffect(() => {
    if (!connected) return;
    let alive = true;

    async function fetch() {
      try {
        const d = await api.get('/dashboard');
        if (!alive) return;
        setData(d);
        setLoading(false);
        lastFetch.current = Date.now();

        // Accumulate KPI sparkline history (last 60 points)
        setKpiHistory((prev) => {
          const now = Date.now();
          const add = (arr, val) => [...arr.slice(-59), { t: now, v: val || 0 }];
          const totalUsed = d.tokens?.totalTokens || 0;
          const input = d.tokens?.totalInputTokens || 0;
          const output = d.tokens?.totalOutputTokens || 0;
          const breakdown = d.agents?.breakdown || [];
          const withQ = breakdown.filter((a) => a.quality?.score != null);
          const avgQ = withQ.length > 0 ? withQ.reduce((s, a) => s + a.quality.score, 0) / withQ.length : 0;
          return {
            tokens: add(prev.tokens, totalUsed),
            cost: add(prev.cost, d.tokens?.totalCostUsd),
            saved: add(prev.saved, avgQ),
            efficiency: add(prev.efficiency, d.rotation?.totalRotations || 0),
            cache: add(prev.cache, d.tokens?.cacheHitRate),
            inputOutput: add(prev.inputOutput, output > 0 ? input / output : 0),
            agents: add(prev.agents, d.agents?.running || 0),
            turns: add(prev.turns, d.tokens?.totalTurns),
          };
        });
      } catch {
        if (alive) setLoading(false);
      }
    }

    fetch();
    const interval = setInterval(fetch, 4000);
    return () => { alive = false; clearInterval(interval); };
  }, [connected]);

  // Derive enriched sub-objects from data
  const agentBreakdown = data?.agents?.breakdown || [];
  const routing = data?.routing || null;
  const rotation = data?.rotation || null;
  const adaptive = data?.adaptive || [];
  const journalist = data?.journalist || null;
  const rotating = rotation?.rotating || [];

  return {
    data, loading, agents, connected, kpiHistory,
    lastFetch: lastFetch.current,
    agentBreakdown, routing, rotation, adaptive, journalist, rotating,
  };
}
