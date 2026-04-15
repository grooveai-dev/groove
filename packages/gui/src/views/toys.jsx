// FSL-1.1-Apache-2.0 — see LICENSE
import { useState, useEffect, useCallback } from 'react';
import { ScrollArea } from '../components/ui/scroll-area';
import { Badge } from '../components/ui/badge';
import { useGrooveStore } from '../stores/groove';
import { api } from '../lib/api';
import { ToyCard, ToyCardSkeleton } from '../components/toys/toy-card';
import { ToyLauncher } from '../components/toys/toy-launcher';
import { ToyCreator } from '../components/toys/toy-creator';
import { Gamepad2, Search, Rocket, Plus } from 'lucide-react';

const CATEGORIES = ['All', 'Space', 'Weather', 'Finance', 'Fun', 'Maps', 'Data'];

export default function ToysView() {
  const [toys, setToys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All');
  const [selectedToy, setSelectedToy] = useState(null);
  const [creatorOpen, setCreatorOpen] = useState(false);
  const teams = useGrooveStore((s) => s.teams);

  const fetchToys = useCallback(() => {
    setLoading(true);
    api.get('/toys')
      .then((d) => setToys(d.toys || d.items || (Array.isArray(d) ? d : [])))
      .catch(() => setToys([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetchToys(); }, [fetchToys]);

  const searchLower = search.toLowerCase();
  const filtered = toys.filter((t) => {
    if (category !== 'All' && t.category?.toLowerCase() !== category.toLowerCase()) return false;
    if (searchLower && !t.name?.toLowerCase().includes(searchLower) && !t.description?.toLowerCase().includes(searchLower)) return false;
    return true;
  });

  const recentToyTeams = (teams || []).filter((t) => (t.name || '').startsWith('Toy:'));

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex-shrink-0 px-5 pt-5 pb-4">
        <div className="flex items-center gap-2.5 mb-1">
          <Gamepad2 size={18} className="text-accent" />
          <h1 className="text-lg font-bold text-text-0 font-sans">Toys</h1>
          <div className="flex-1" />
          <button
            onClick={() => setCreatorOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold font-sans rounded-full cursor-pointer select-none transition-colors bg-accent/15 text-accent border border-accent/25 hover:bg-accent/25"
          >
            <Plus size={13} />
            New
          </button>
        </div>
        <p className="text-xs text-text-3 font-sans">Plug in an API and start building</p>
      </div>

      {/* Search + category bar */}
      <div className="flex-shrink-0 px-5 pb-4 space-y-3">
        {/* Search */}
        <div className="relative w-full max-w-sm">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-4" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search toys..."
            className="w-full bg-surface-1 border border-border-subtle rounded pl-8 pr-3 py-1.5 text-xs text-text-0 font-sans placeholder:text-text-4 focus:outline-none focus:border-accent/50"
          />
        </div>

        {/* Categories */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => setCategory(cat)}
              className={`px-3 py-1.5 text-xs font-semibold font-sans rounded-full cursor-pointer select-none transition-colors ${
                category === cat
                  ? 'bg-accent/15 text-accent border border-accent/25'
                  : 'text-text-3 hover:text-text-1 border border-transparent hover:border-border-subtle'
              }`}
            >
              {cat}
            </button>
          ))}
          <div className="flex-1" />
          <span className="text-2xs text-text-4 font-mono">{filtered.length}</span>
        </div>
      </div>

      {/* Content */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="px-5 pt-1 pb-5">
          {/* Grid */}
          <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(260px,1fr))]">
            {loading
              ? Array.from({ length: 6 }).map((_, i) => <ToyCardSkeleton key={i} />)
              : <>
                  {filtered.map((t) => <ToyCard key={t.id} toy={t} onClick={setSelectedToy} />)}
                  <button
                    onClick={() => setCreatorOpen(true)}
                    className="flex flex-col items-center justify-center gap-2 p-4 rounded-xl border-2 border-dashed border-border-subtle text-text-4 hover:text-accent hover:border-accent/30 hover:bg-accent/5 transition-colors cursor-pointer min-h-[140px]"
                  >
                    <Plus size={20} />
                    <span className="text-xs font-semibold font-sans">Add API</span>
                  </button>
                </>
            }
          </div>

          {!loading && filtered.length === 0 && (
            <div className="text-center py-16 text-text-4 font-sans text-sm">
              No toys found. Try a different search or category.
            </div>
          )}

          {/* Recent Toys */}
          {recentToyTeams.length > 0 && (
            <div className="mt-8">
              <h3 className="text-xs font-semibold text-text-2 font-sans uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <Rocket size={12} />
                Recent Toys ({recentToyTeams.length})
              </h3>
              <div className="space-y-1.5">
                {recentToyTeams.map((team) => (
                  <div key={team.id} className="flex items-center gap-3 px-3 py-2.5 rounded-md bg-surface-1 border border-border-subtle">
                    <div className="w-8 h-8 rounded-md bg-accent/10 flex items-center justify-center flex-shrink-0">
                      <Gamepad2 size={14} className="text-accent" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-semibold text-text-0 font-sans truncate">{team.name}</div>
                      <div className="text-2xs text-text-4 font-sans">{team.agents?.length || 0} agents</div>
                    </div>
                    <Badge variant="accent">Active</Badge>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Launcher sheet */}
      <ToyLauncher
        toy={selectedToy}
        open={!!selectedToy}
        onClose={() => setSelectedToy(null)}
      />

      {/* Creator sheet */}
      <ToyCreator
        open={creatorOpen}
        onClose={() => setCreatorOpen(false)}
        onCreated={() => fetchToys()}
      />
    </div>
  );
}
