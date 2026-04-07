// GROOVE — Lightweight MIME type lookup (no deps)
// FSL-1.1-Apache-2.0 — see LICENSE

const TYPES = {
  // Images
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  svg: 'image/svg+xml', webp: 'image/webp', ico: 'image/x-icon', bmp: 'image/bmp',
  avif: 'image/avif',
  // Video
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', avi: 'video/x-msvideo',
  mkv: 'video/x-matroska', ogv: 'video/ogg',
  // Audio
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', flac: 'audio/flac',
  // Text/code
  js: 'text/javascript', mjs: 'text/javascript', jsx: 'text/javascript',
  ts: 'text/typescript', tsx: 'text/typescript',
  css: 'text/css', html: 'text/html', json: 'application/json',
  md: 'text/markdown', txt: 'text/plain', xml: 'application/xml',
  yaml: 'text/yaml', yml: 'text/yaml', toml: 'text/plain',
  py: 'text/x-python', rs: 'text/x-rust', go: 'text/x-go',
  sh: 'text/x-sh', sql: 'text/x-sql',
  // Other
  pdf: 'application/pdf', zip: 'application/zip', wasm: 'application/wasm',
};

export function lookup(filename) {
  const ext = filename.split('.').pop()?.toLowerCase();
  return TYPES[ext] || 'application/octet-stream';
}

export function isImage(filename) {
  const ext = filename.split('.').pop()?.toLowerCase();
  return ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp', 'avif'].includes(ext);
}

export function isVideo(filename) {
  const ext = filename.split('.').pop()?.toLowerCase();
  return ['mp4', 'webm', 'mov', 'avi', 'mkv', 'ogv'].includes(ext);
}

export function isMedia(filename) {
  return isImage(filename) || isVideo(filename);
}
