// FSL-1.1-Apache-2.0 — see LICENSE
import { useState, useEffect, useRef } from 'react';
import { ScrollArea } from '../components/ui/scroll-area';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Skeleton } from '../components/ui/skeleton';
import { SkillCard, SkillCardSkeleton } from '../components/marketplace/skill-card';
import { MarketplaceCard } from '../components/marketplace/marketplace-card';
import { SearchBar } from '../components/marketplace/search-bar';
import { CategoryBar } from '../components/marketplace/category-bar';
import { MarketplaceBadge } from '../components/marketplace/marketplace-badge';
import { StarRating } from '../components/marketplace/star-rating';
import { PriceBadge } from '../components/marketplace/price-badge';
import { VerifiedShield } from '../components/marketplace/verified-shield';
import { markFavorites } from '../components/marketplace/favorites';
import { api } from '../lib/api';
import { useToast } from '../lib/hooks/use-toast';
import { fmtNum, timeAgo } from '../lib/format';
import { useGrooveStore } from '../stores/groove';
import {
  ChevronLeft, ChevronDown, Sparkles, Plug, LogIn, LogOut,
  User, Upload, Package, Download, ShoppingBag,
} from 'lucide-react';

// ── Skill Detail ─────────────────────────────────────────
function SkillDetail({ skill, onBack }) {
  const toast = useToast();
  const [content, setContent] = useState('');
  const [requiresPurchase, setRequiresPurchase] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [installed, setInstalled] = useState(skill.installed);
  const [loadingContent, setLoadingContent] = useState(true);

  useEffect(() => {
    setLoadingContent(true);
    api.get(`/skills/${skill.id}/content`)
      .then((d) => {
        setContent(d.content || '');
        setRequiresPurchase(d.requiresPurchase || false);
      })
      .catch(() => {})
      .finally(() => setLoadingContent(false));
  }, [skill.id]);

  async function handleInstall() {
    setInstalling(true);
    try {
      await api.post(`/skills/${skill.id}/install`);
      setInstalled(true);
      toast.success(`${skill.name} installed`);
    } catch (err) { toast.error('Install failed', err.message); }
    setInstalling(false);
  }

  async function handleBuy() {
    const { marketplaceAuthenticated, marketplaceLogin, marketplaceCheckout } = useGrooveStore.getState();
    if (!marketplaceAuthenticated) {
      marketplaceLogin();
      return;
    }
    try {
      await marketplaceCheckout(skill.id);
    } catch { /* toast handles */ }
  }

  return (
    <ScrollArea className="h-full">
      <div className="px-6 py-5">
        <button onClick={onBack} className="flex items-center gap-1 text-xs text-text-3 font-sans hover:text-text-0 cursor-pointer bg-transparent border-0 mb-4">
          <ChevronLeft size={14} /> Back
        </button>

        <div className="flex gap-8">
          {/* Left */}
          <div className="flex-1 min-w-0">
            <div className="flex items-start gap-3">
              <div className="w-11 h-11 rounded-lg flex items-center justify-center flex-shrink-0 bg-accent/10 border border-accent/20 text-[22px]">
                {skill.icon || skill.name?.[0]?.toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <h1 className="text-lg font-bold text-text-0 font-sans">{skill.name}</h1>
                <div className="flex items-center gap-2 mt-0.5 text-xs text-text-3 font-sans">
                  <span>{skill.author || 'Community'}</span>
                  {(skill.source === 'claude-official' || skill.verified) && <VerifiedShield type={skill.source} size={13} />}
                </div>
              </div>
            </div>

            <p className="mt-3 text-sm text-text-2 font-sans leading-relaxed">{skill.description}</p>

            {skill.tags?.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-3">
                {skill.tags.map((tag) => (
                  <span key={tag} className="text-2xs text-text-3 font-sans px-2 py-0.5 rounded bg-surface-4">
                    {tag}
                  </span>
                ))}
              </div>
            )}

            <div className="h-px bg-border-subtle my-5" />

            {loadingContent ? (
              <div className="space-y-2">
                <div className="h-3 w-48 bg-surface-4 rounded animate-pulse" />
                <div className="h-3 w-full bg-surface-4 rounded animate-pulse" />
                <div className="h-3 w-3/4 bg-surface-4 rounded animate-pulse" />
              </div>
            ) : content ? (
              <div className="text-sm text-text-2 font-sans leading-relaxed">
                <h2 className="text-sm font-semibold text-text-0 mb-2">About</h2>
                <pre className="whitespace-pre-wrap font-sans">{content}</pre>
              </div>
            ) : requiresPurchase ? (
              <div className="bg-warning/5 border border-warning/15 rounded-lg px-4 py-3">
                <p className="text-sm text-text-1 font-sans font-medium">Paid skill — purchase to view content</p>
                <p className="text-xs text-text-3 font-sans mt-1">Sign in and purchase this skill to access its full instructions.</p>
              </div>
            ) : (
              <p className="text-xs text-text-4 font-sans">Content loading failed — check your connection.</p>
            )}
          </div>

          {/* Right sidebar */}
          <div className="w-[240px] flex-shrink-0">
            <div className="bg-surface-1 border border-border-subtle rounded-lg p-4 sticky top-4">
              <PriceBadge price={skill.price || 0} size="md" />

              {requiresPurchase && !installed ? (
                <button
                  onClick={handleBuy}
                  className="w-full mt-3 py-2 px-3 text-xs font-sans font-semibold rounded cursor-pointer transition-all hover:opacity-85 flex items-center justify-center gap-2 border bg-warning/15 text-warning border-warning/20 hover:bg-warning/25"
                >
                  Buy ${(skill.price || 0).toFixed(2)}
                </button>
              ) : (
                <button
                  onClick={handleInstall}
                  disabled={installing || installed}
                  className={`w-full mt-3 py-2 px-3 text-xs font-sans font-semibold rounded cursor-pointer transition-all hover:opacity-85 disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2 border ${installed ? 'bg-success/15 text-success border-success/20' : 'bg-accent/15 text-accent border-accent/20 hover:bg-accent/25'}`}
                >
                  {installing ? 'Installing...' : installed ? '\u2713 Installed' : 'Install'}
                </button>
              )}

              <div className="mt-4 flex flex-col gap-2.5">
                {[
                  ['Downloads', <span key="d" className="font-mono text-text-0">{fmtNum(skill.downloads || 0)}</span>],
                  ['Rating', <StarRating key="r" rating={skill.rating || 0} count={skill.rating_count || skill.ratingCount} size="sm" />],
                  ['Version', <span key="v" className="font-mono text-text-0">{skill.version || '1.0.0'}</span>],
                  ['Category', <MarketplaceBadge key="c" label={skill.category || 'general'} variant={skill.category || 'draft'} />],
                  ['Source', <span key="s" className="text-text-0">{skill.source === 'claude-official' ? 'Anthropic' : 'Community'}</span>],
                ].map(([label, value]) => (
                  <div key={label} className="flex justify-between items-center text-xs font-sans">
                    <span className="text-text-3">{label}</span>
                    {value}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </ScrollArea>
  );
}

// ── Skills Browse ────────────────────────────────────────
function SkillsBrowse() {
  const [skills, setSkills] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [sort, setSort] = useState('popular');
  const [selectedSkill, setSelectedSkill] = useState(null);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (category) params.set('category', category);
    if (sort) params.set('sort', sort);
    api.get(`/skills/registry?${params}`)
      .then((d) => setSkills(markFavorites(d.skills || d.items || (Array.isArray(d) ? d : []))))
      .catch(() => setSkills([]))
      .finally(() => setLoading(false));
  }, [search, category, sort]);

  if (selectedSkill) {
    return <SkillDetail skill={selectedSkill} onBack={() => setSelectedSkill(null)} />;
  }

  return (
    <ScrollArea className="h-full">
      <div className="px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="w-72">
            <SearchBar value={search} onChange={setSearch} />
          </div>
          <CategoryBar selected={category} onSelect={setCategory} />
          <div className="flex-1" />
          <div className="relative flex-shrink-0">
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value)}
              className="appearance-none font-sans cursor-pointer pr-7 py-2 pl-3 text-xs bg-surface-0 border border-border-subtle rounded text-text-1 focus:outline-none"
            >
              <option value="popular">Popular</option>
              <option value="rating">Top Rated</option>
              <option value="newest">Newest</option>
              <option value="name">A-Z</option>
            </select>
            <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-text-4 pointer-events-none" />
          </div>
          <span className="text-2xs text-text-4 font-mono flex-shrink-0">{skills.length}</span>
        </div>

        <div className="mt-4 grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
          {loading
            ? Array.from({ length: 8 }).map((_, i) => <SkillCardSkeleton key={i} />)
            : skills.map((s) => <SkillCard key={s.id} skill={s} onClick={setSelectedSkill} />)
          }
        </div>

        {!loading && skills.length === 0 && (
          <div className="text-center py-16 text-text-4 font-sans text-sm">No skills found.</div>
        )}
      </div>
    </ScrollArea>
  );
}

// ── Integrations Browse ──────────────────────────────────
function IntegrationsBrowse() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const toast = useToast();

  useEffect(() => {
    setLoading(true);
    api.get(`/integrations/registry?search=${encodeURIComponent(search)}`)
      .then((d) => setItems(d.integrations || d.items || (Array.isArray(d) ? d : [])))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [search]);

  return (
    <ScrollArea className="h-full">
      <div className="px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="w-72">
            <SearchBar value={search} onChange={setSearch} placeholder="Search integrations..." />
          </div>
          <div className="flex-1" />
          <span className="text-2xs text-text-4 font-mono flex-shrink-0">{items.length}</span>
        </div>

        <div className="mt-4 grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
          {loading
            ? Array.from({ length: 6 }).map((_, i) => <SkillCardSkeleton key={i} />)
            : items.map((item) => <MarketplaceCard key={item.id} item={item} onClick={() => toast.info(`${item.name} — install via CLI: groove integrations install ${item.id}`)} />)
          }
        </div>

        {!loading && items.length === 0 && (
          <div className="text-center py-16 text-text-4 font-sans text-sm">No integrations found.</div>
        )}
      </div>
    </ScrollArea>
  );
}

// ── My Library (Purchases + Installed) ───────────────────
function MyLibrary() {
  const authenticated = useGrooveStore((s) => s.marketplaceAuthenticated);
  const login = useGrooveStore((s) => s.marketplaceLogin);
  const [purchases, setPurchases] = useState([]);
  const [installed, setInstalled] = useState([]);
  const [loading, setLoading] = useState(true);
  const toast = useToast();
  const fileRef = useRef(null);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      authenticated ? api.get('/auth/purchases').then((d) => d.purchases || []).catch(() => []) : Promise.resolve([]),
      api.get('/skills/installed').then((d) => Array.isArray(d) ? d : d.skills || []).catch(() => []),
    ]).then(([p, i]) => {
      setPurchases(p);
      setInstalled(i);
    }).finally(() => setLoading(false));
  }, [authenticated]);

  async function handleImport(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const content = await file.text();
      const name = file.name.replace(/\.md$/i, '');
      await api.post('/skills/import', { name, content });
      toast.success(`Imported "${name}"`);
      // Refresh installed list
      const data = await api.get('/skills/installed');
      setInstalled(Array.isArray(data) ? data : data.skills || []);
    } catch (err) {
      toast.error('Import failed', err.message);
    }
    e.target.value = '';
  }

  if (loading) {
    return (
      <div className="p-5 space-y-3">
        {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-14 rounded-md" />)}
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="px-5 py-4 space-y-6">
        {/* Import button */}
        <div className="flex items-center gap-3">
          <input ref={fileRef} type="file" accept=".md" onChange={handleImport} className="hidden" />
          <Button
            variant="secondary"
            size="md"
            onClick={() => fileRef.current?.click()}
            className="gap-1.5"
          >
            <Upload size={13} />
            Import .md Skill
          </Button>
          <span className="text-2xs text-text-4 font-sans">Drop a markdown skill file to install locally</span>
        </div>

        {/* Purchases */}
        {authenticated && purchases.length > 0 && (
          <div>
            <h3 className="text-xs font-semibold text-text-2 font-sans uppercase tracking-wider mb-3 flex items-center gap-1.5">
              <ShoppingBag size={12} />
              Purchases ({purchases.length})
            </h3>
            <div className="space-y-1.5">
              {purchases.map((p) => (
                <div key={p.id || p.skill_id} className="flex items-center gap-3 px-3 py-2.5 rounded-md bg-surface-1 border border-border-subtle">
                  <div className="w-8 h-8 rounded-md bg-accent/10 flex items-center justify-center text-sm flex-shrink-0">
                    {p.skill_icon || p.skill_name?.[0]?.toUpperCase() || '?'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold text-text-0 font-sans truncate">{p.skill_name || p.skill_id}</div>
                    <div className="text-2xs text-text-4 font-sans">${(p.amount || 0).toFixed(2)} · {timeAgo(p.created_at)}</div>
                  </div>
                  <Badge variant="success" className="text-2xs flex-shrink-0">Owned</Badge>
                </div>
              ))}
            </div>
          </div>
        )}

        {authenticated && purchases.length === 0 && (
          <div className="bg-surface-1 border border-border-subtle rounded-md px-4 py-6 text-center">
            <ShoppingBag size={20} className="mx-auto text-text-4 mb-2" />
            <p className="text-xs text-text-3 font-sans">No purchases yet</p>
          </div>
        )}

        {!authenticated && (
          <div className="bg-surface-1 border border-border-subtle rounded-md px-4 py-6 text-center">
            <ShoppingBag size={20} className="mx-auto text-text-4 mb-2" />
            <p className="text-xs text-text-2 font-sans mb-3">Sign in to see your purchases</p>
            <Button variant="primary" size="sm" onClick={login} className="gap-1.5 mx-auto">
              <LogIn size={12} /> Sign in
            </Button>
          </div>
        )}

        {/* Installed Skills */}
        <div>
          <h3 className="text-xs font-semibold text-text-2 font-sans uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <Package size={12} />
            Installed ({installed.length})
          </h3>
          {installed.length === 0 ? (
            <div className="bg-surface-1 border border-border-subtle rounded-md px-4 py-6 text-center">
              <Download size={20} className="mx-auto text-text-4 mb-2" />
              <p className="text-xs text-text-3 font-sans">No skills installed — browse the Skills tab or import a .md file</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {installed.map((s) => (
                <div key={s.id} className="flex items-center gap-3 px-3 py-2.5 rounded-md bg-surface-1 border border-border-subtle group">
                  <div className="w-8 h-8 rounded-md bg-accent/10 flex items-center justify-center text-sm flex-shrink-0">
                    {s.icon || s.name?.[0]?.toUpperCase() || '?'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold text-text-0 font-sans truncate">{s.name || s.id}</div>
                    <div className="text-2xs text-text-3 font-sans truncate">{s.description || s.category || 'local skill'}</div>
                  </div>
                  <Badge variant="accent" className="text-2xs flex-shrink-0">Installed</Badge>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </ScrollArea>
  );
}

// ── Auth Area (header right) ─────────────────────────────
function AuthArea() {
  const authenticated = useGrooveStore((s) => s.marketplaceAuthenticated);
  const user = useGrooveStore((s) => s.marketplaceUser);
  const login = useGrooveStore((s) => s.marketplaceLogin);
  const logout = useGrooveStore((s) => s.marketplaceLogout);

  if (authenticated) {
    return (
      <div className="flex items-center gap-1">
        <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-surface-3 border border-border-subtle">
          <div className="w-4 h-4 rounded-full bg-accent/20 flex items-center justify-center">
            <User size={9} className="text-accent" />
          </div>
          <span className="text-xs text-text-0 font-sans font-medium max-w-[120px] truncate">
            {user?.displayName || user?.id || 'Account'}
          </span>
        </div>
        <button
          onClick={logout}
          className="flex items-center gap-1 px-2 py-1.5 rounded text-xs text-text-3 hover:text-text-0 hover:bg-surface-3 font-sans cursor-pointer transition-colors"
        >
          <LogOut size={11} />
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={login}
      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold font-sans text-text-0 bg-accent/15 border border-accent/25 rounded hover:bg-accent/25 cursor-pointer transition-colors"
    >
      <LogIn size={12} />
      Sign in
    </button>
  );
}

// ── Main ─────────────────────────────────────────────────
export default function MarketplaceView() {
  const [tab, setTab] = useState('skills');

  const tabs = [
    { id: 'skills', label: 'Skills', icon: Sparkles },
    { id: 'integrations', label: 'Integrations', icon: Plug },
    { id: 'library', label: 'My Library', icon: Package },
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex-shrink-0 bg-surface-1 border-b border-border-subtle">
        <div className="flex items-center px-5 h-11">
          <div className="flex items-center">
            {tabs.map((t) => {
              const Icon = t.icon;
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-semibold font-sans cursor-pointer select-none border-b-2 -mb-px transition-colors ${tab === t.id ? 'border-accent text-text-0' : 'border-transparent text-text-3 hover:text-text-1'}`}
                >
                  <Icon size={12} />
                  {t.label}
                </button>
              );
            })}
          </div>
          <div className="flex-1" />
          <AuthArea />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0">
        {tab === 'skills' && <SkillsBrowse />}
        {tab === 'integrations' && <IntegrationsBrowse />}
        {tab === 'library' && <MyLibrary />}
      </div>
    </div>
  );
}
