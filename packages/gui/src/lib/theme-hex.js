// FSL-1.1-Apache-2.0 — see LICENSE
// Raw hex values for Canvas 2D rendering (CSS vars don't work in canvas)

export function hexAlpha(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

export const HEX = {
  // Surfaces
  surface0: '#1a1e25',
  surface1: '#1e2127',
  surface2: '#24282f',
  surface3: '#282c34',
  surface4: '#2c313a',
  surface5: '#333842',
  surface6: '#3a3f4b',

  // Text
  text0: '#e6e6e6',
  text1: '#bcc2cd',
  text2: '#8b929e',
  text3: '#6e7681',
  text4: '#505862',

  // Borders
  border: '#3e4451',

  // Semantic
  accent: '#33afbc',
  accentMuted: '#33afbc99',
  success: '#4ae168',
  warning: '#e5c07b',
  danger: '#e06c75',
  info: '#61afef',
  purple: '#c678dd',
  orange: '#d19a66',
};
