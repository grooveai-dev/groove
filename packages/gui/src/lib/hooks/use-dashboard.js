// FSL-1.1-Apache-2.0 — see LICENSE
import { useState, useEffect, useRef } from 'react';
import { useGrooveStore } from '../../stores/groove';
import { api } from '../api';

export function useDashboard() {
  const connected = useGrooveStore((s) => s.connected);
  const agents = useGrooveStore((s) => s.agents);

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [kpiHistory, setKpiHistory] = useState({ tokens: [], cost: [], saved: [], efficiency: [], cache: [] });
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
          return {
            tokens: add(prev.tokens, d.tokens?.totalUsed),
            cost: add(prev.cost, d.tokens?.totalCostUsd),
            saved: add(prev.saved, d.tokens?.totalSaved),
            efficiency: add(prev.efficiency, (() => {
              const h = (d.tokens?.totalUsed || 0) + (d.tokens?.totalSaved || 0);
              return h > 0 ? ((d.tokens?.totalSaved || 0) / h) * 100 : 0;
            })()),
            cache: add(prev.cache, d.tokens?.cacheHitRate),
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

  return { data, loading, agents, connected, kpiHistory, lastFetch: lastFetch.current };
}
