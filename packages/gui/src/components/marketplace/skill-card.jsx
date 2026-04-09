// FSL-1.1-Apache-2.0 — see LICENSE
import { useState } from 'react';
import { StarRating } from './star-rating';
import { MarketplaceBadge } from './marketplace-badge';
import { PriceBadge } from './price-badge';
import { VerifiedShield } from './verified-shield';
import { toggleFavorite, isFavorite } from './favorites';
import { fmtNum } from '../../lib/format';
import { cn } from '../../lib/cn';

function HeartIcon({ filled, size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? '#f87171' : 'none'} stroke={filled ? '#f87171' : 'rgba(255,255,255,0.3)'} strokeWidth="2">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

export function SkillCard({ skill, onClick }) {
  const [fav, setFav] = useState(() => isFavorite(skill.id));

  function handleFav(e) {
    e.stopPropagation();
    setFav(toggleFavorite(skill.id));
  }

  return (
    <div
      onClick={() => onClick?.(skill)}
      className={cn(
        'flex flex-col cursor-pointer group',
        'bg-surface-1 border border-border-subtle rounded-md',
        'hover:border-accent/30 hover:bg-surface-2',
        'transition-all duration-150',
      )}
      style={{ padding: 20, minHeight: 280 }}
    >
      {/* Top: icon + heart */}
      <div className="flex justify-between items-start">
        <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 bg-accent/12 text-[20px]">
          {skill.icon || skill.name?.[0]?.toUpperCase() || '?'}
        </div>
        <button
          onClick={handleFav}
          className="opacity-40 group-hover:opacity-80 hover:!opacity-100 transition-opacity cursor-pointer bg-transparent border-0 p-0"
        >
          <HeartIcon filled={fav} />
        </button>
      </div>

      {/* Title */}
      <div className="mt-3 text-[15px] font-semibold text-text-0 font-sans line-clamp-2 leading-snug">
        {skill.name}
      </div>

      {/* Author */}
      <div className="mt-1 flex items-center gap-1.5 text-xs text-text-3 font-sans">
        <span>by {skill.author || 'Community'}</span>
        {(skill.source === 'claude-official' || skill.verified) && <VerifiedShield type={skill.source} size={12} />}
      </div>

      {/* Description */}
      <div className="mt-2.5 text-xs text-text-2 font-sans line-clamp-3 flex-1 leading-relaxed">
        {skill.description}
      </div>

      {/* Category */}
      <div className="mt-3">
        <MarketplaceBadge label={skill.category || 'general'} variant={skill.category || 'draft'} />
      </div>

      {/* Divider */}
      <div className="h-px bg-border-subtle my-3" />

      {/* Stats */}
      <div className="flex items-center justify-between gap-2">
        <StarRating rating={skill.rating || 0} count={skill.rating_count || skill.ratingCount || 0} size="sm" />
        <span className="flex items-center gap-1 text-xs text-text-3 font-mono">
          <DownloadIcon />
          {fmtNum(skill.downloads || 0)}
        </span>
        <PriceBadge price={skill.price || 0} size="sm" />
      </div>
    </div>
  );
}

export function SkillCardSkeleton() {
  return (
    <div className="bg-surface-1 border border-border-subtle rounded-md animate-pulse" style={{ padding: 20, minHeight: 280 }}>
      <div className="w-10 h-10 rounded-full bg-surface-4" />
      <div className="mt-3 h-4 w-[70%] rounded bg-surface-4" />
      <div className="mt-2 h-3 w-[40%] rounded bg-surface-4" />
      <div className="mt-3.5 h-3 w-full rounded bg-surface-4" />
      <div className="mt-1.5 h-3 w-[90%] rounded bg-surface-4" />
      <div className="mt-1.5 h-3 w-[60%] rounded bg-surface-4" />
      <div className="mt-3.5 h-5 w-[50px] rounded bg-surface-4" />
      <div className="h-px bg-surface-4 my-3" />
      <div className="flex justify-between">
        <div className="h-3 w-16 rounded bg-surface-4" />
        <div className="h-3 w-12 rounded bg-surface-4" />
        <div className="h-3 w-10 rounded bg-surface-4" />
      </div>
    </div>
  );
}
