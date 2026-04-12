// FSL-1.1-Apache-2.0 — see LICENSE
import { Download, Star, CheckCircle } from 'lucide-react';
import { cn } from '../../lib/cn';
import { Badge } from '../ui/badge';
import { fmtNum } from '../../lib/format';

// Well-known integration logos via CDN (simple-icons on cdn.simpleicons.org)
export const INTEGRATION_LOGOS = {
  'google-workspace': 'https://cdn.simpleicons.org/google/white',
  github:      'https://cdn.simpleicons.org/github/white',
  stripe:      'https://cdn.simpleicons.org/stripe/635BFF',
  gmail:       'https://cdn.simpleicons.org/gmail/EA4335',
  'google-calendar': 'https://cdn.simpleicons.org/googlecalendar/4285F4',
  'google-drive':    'https://cdn.simpleicons.org/googledrive/4285F4',
  'google-docs':     'https://cdn.simpleicons.org/googledocs/4285F4',
  'google-sheets':   'https://cdn.simpleicons.org/googlesheets/34A853',
  'google-slides':   'https://cdn.simpleicons.org/googleslides/FBBC04',
  'google-maps':     'https://cdn.simpleicons.org/googlemaps/4285F4',
  postgres:    'https://cdn.simpleicons.org/postgresql/4169E1',
  notion:      'https://cdn.simpleicons.org/notion/white',
  linear:      'https://cdn.simpleicons.org/linear/5E6AD2',
  'brave-search': 'https://cdn.simpleicons.org/brave/FB542B',
  'home-assistant': 'https://cdn.simpleicons.org/homeassistant/18BCF2',
  sentry:      'https://cdn.simpleicons.org/sentry/362D59',
  elevenlabs:  'https://cdn.simpleicons.org/elevenlabs/white',
  hubspot:     'https://cdn.simpleicons.org/hubspot/FF7A59',
  jira:        'https://cdn.simpleicons.org/jira/0052CC',
  sendgrid:    'https://cdn.simpleicons.org/sendgrid/1A82E2',
  resend:      'https://cdn.simpleicons.org/resend/white',
  replicate:   'https://cdn.simpleicons.org/replicate/white',
  vercel:      'https://cdn.simpleicons.org/vercel/white',
  supabase:    'https://cdn.simpleicons.org/supabase/3FCF8E',
  mixpanel:    'https://cdn.simpleicons.org/mixpanel/7856FF',
  datadog:     'https://cdn.simpleicons.org/datadog/632CA6',
  airtable:    'https://cdn.simpleicons.org/airtable/18BFFF',
  zendesk:     'https://cdn.simpleicons.org/zendesk/03363D',
  intercom:    'https://cdn.simpleicons.org/intercom/6AFDEF',
  twilio:      'https://cdn.simpleicons.org/twilio/F22F46',
  telnyx:      'https://cdn.simpleicons.org/telnyx/00C08B',
  aws:         'https://cdn.simpleicons.org/amazonaws/FF9900',
  plaid:       'https://cdn.simpleicons.org/plaid/white',
};

function ItemIcon({ item, size = 40 }) {
  const logoUrl = INTEGRATION_LOGOS[item.id];

  if (logoUrl) {
    return (
      <div
        className="rounded-md bg-surface-4 flex items-center justify-center flex-shrink-0 overflow-hidden"
        style={{ width: size, height: size }}
      >
        <img
          src={logoUrl}
          alt={item.name}
          className="w-5 h-5"
          onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }}
        />
        <div className="hidden items-center justify-center w-full h-full text-lg font-bold font-sans text-text-1">
          {(item.name || '?')[0]}
        </div>
      </div>
    );
  }

  // Fallback: first letter with accent color
  const initial = (item.name || '?')[0].toUpperCase();
  const hue = item.name ? item.name.charCodeAt(0) * 37 % 360 : 200;

  return (
    <div
      className="rounded-md flex items-center justify-center flex-shrink-0 text-lg font-bold font-sans"
      style={{
        width: size,
        height: size,
        background: `hsl(${hue}, 40%, 18%)`,
        color: `hsl(${hue}, 60%, 65%)`,
      }}
    >
      {initial}
    </div>
  );
}

export function MarketplaceCard({ item, onClick, className, statusBadge }) {
  const installed = item.installed;

  return (
    <button
      onClick={() => onClick(item)}
      className={cn(
        'flex flex-col p-5 rounded-md border border-border-subtle bg-surface-1 text-left',
        'hover:border-accent/30 hover:bg-surface-2',
        'transition-all duration-150 cursor-pointer group',
        className,
      )}
      style={{ minHeight: 200 }}
    >
      {/* Icon + name */}
      <div className="flex items-center gap-3 mb-3">
        <ItemIcon item={item} size={36} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-[14px] font-semibold text-text-0 font-sans truncate">{item.name}</span>
            {(item.verified || item.verified === 'mcp-official') && <CheckCircle size={11} className="text-accent flex-shrink-0" />}
          </div>
          <span className="text-2xs text-text-3 font-sans">{item.author || 'Community'}</span>
        </div>
      </div>

      {/* Description */}
      <p className="text-xs text-text-2 font-sans line-clamp-3 mb-3 flex-1 leading-relaxed">{item.description}</p>

      {/* Divider */}
      <div className="h-px bg-border-subtle my-2" />

      {/* Stats — same layout as skill cards */}
      <div className="flex items-center gap-3 text-2xs text-text-3 font-sans">
        <span className="flex items-center gap-1">
          <Download size={10} />
          {fmtNum(item.downloads || 0)}
        </span>
        {(item.rating || 0) > 0 && (
          <span className="flex items-center gap-1">
            <Star size={10} className="text-warning" fill="currentColor" />
            {item.rating?.toFixed(1)}
          </span>
        )}
        <span className="flex-1" />
        {statusBadge || (installed && (
          <Badge variant="accent" className="text-2xs">
            {item._installedCount ? `${item._installedCount} active` : 'Installed'}
          </Badge>
        ))}
      </div>
    </button>
  );
}
