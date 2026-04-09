// FSL-1.1-Apache-2.0 — see LICENSE
const KEY = 'groove_favorites';

function load() {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
}

export function isFavorite(id) {
  return load().includes(id);
}

export function toggleFavorite(id) {
  const favs = load();
  const idx = favs.indexOf(id);
  if (idx >= 0) favs.splice(idx, 1);
  else favs.push(id);
  localStorage.setItem(KEY, JSON.stringify(favs));
  return idx < 0; // returns new state
}

export function markFavorites(skills) {
  const favs = new Set(load());
  return skills.map((s) => ({ ...s, favorited: favs.has(s.id) }));
}
