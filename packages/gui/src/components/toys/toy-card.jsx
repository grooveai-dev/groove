// FSL-1.1-Apache-2.0 — see LICENSE
import { Card } from '../ui/card';
import { Badge } from '../ui/badge';
import * as Icons from 'lucide-react';

const DIFFICULTY_VARIANT = {
  beginner: 'success',
  intermediate: 'warning',
  advanced: 'danger',
};

function resolveIcon(name) {
  if (!name) return Icons.Box;
  const pascal = name.replace(/(^|-)(\w)/g, (_, __, c) => c.toUpperCase());
  return Icons[pascal] || Icons[name] || Icons.Box;
}

export function ToyCard({ toy, onClick }) {
  const Icon = resolveIcon(toy.icon);

  return (
    <Card
      hover
      className="group flex flex-col p-4 gap-3 transition-all duration-150 hover:scale-[1.02] hover:shadow-lg hover:shadow-black/20"
      onClick={() => onClick(toy)}
    >
      {/* Icon + name + category */}
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 bg-accent/10 border border-accent/20 text-accent">
          <Icon size={20} />
        </div>
        <div className="flex-1 min-w-0 pt-0.5">
          <h3 className="text-sm font-semibold text-text-0 font-sans truncate pr-1">{toy.name}</h3>
        </div>
        <Badge variant="default" className="flex-shrink-0 mt-0.5">
          {toy.category}
        </Badge>
      </div>

      {/* Description — 2 lines max */}
      <p className="text-xs text-text-2 font-sans leading-relaxed line-clamp-2">{toy.description}</p>

      {/* Bottom badges */}
      <div className="flex items-center gap-1.5 mt-auto flex-wrap">
        {toy.custom && (
          <Badge variant="accent">Custom</Badge>
        )}
        <Badge variant={DIFFICULTY_VARIANT[toy.difficulty] || 'default'}>
          {toy.difficulty || 'beginner'}
        </Badge>
        <Badge variant={toy.authType === 'none' ? 'success' : 'warning'}>
          {toy.authType === 'none' ? 'No Key Required' : 'API Key Required'}
        </Badge>
      </div>
    </Card>
  );
}

export function ToyCardSkeleton() {
  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-lg bg-surface-4 animate-pulse" />
        <div className="flex-1 space-y-2 pt-1">
          <div className="h-3.5 w-24 bg-surface-4 rounded animate-pulse" />
        </div>
      </div>
      <div className="space-y-1.5">
        <div className="h-3 w-full bg-surface-4 rounded animate-pulse" />
        <div className="h-3 w-3/4 bg-surface-4 rounded animate-pulse" />
      </div>
      <div className="flex gap-1.5">
        <div className="h-5 w-16 bg-surface-4 rounded animate-pulse" />
        <div className="h-5 w-24 bg-surface-4 rounded animate-pulse" />
      </div>
    </Card>
  );
}
