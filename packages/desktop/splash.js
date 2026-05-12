// FSL-1.1-Apache-2.0 — see LICENSE
//
// Desktop app splash / welcome page — the first thing users see when Groove opens.
//
// This is the DESKTOP (Electron) splash page rendered as inline HTML/CSS/JS.
// It is NOT the web GUI splash page (packages/gui/src/components/layout/welcome-splash.jsx).
//
// Structure:
//   - CSS:  hero, landing grid, activity rail, wizard, create-project
//   - HTML: hero, landing (main-actions wraps Start + Activity), whats-new, hidden panels
//   - JS:   event handlers, recents, SSH, wizard logic
//
// The HTML references window.groove.* IPC methods exposed by preload.cjs.
//

export function getWelcomeHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:">
<title>Groove</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { height: 100%; }
body {
  background: #0a0c10;
  color: #e6e8ed;
  font-family: -apple-system, BlinkMacSystemFont, 'Inter', system-ui, sans-serif;
  font-size: 13px;
  overflow: hidden; user-select: none;
  display: flex; flex-direction: column;
  position: relative;
}
body::before {
  content: ''; position: fixed; top: -240px; left: 50%;
  transform: translateX(-50%);
  width: 1200px; height: 600px;
  background: radial-gradient(ellipse at center, rgba(51,175,188,0.12), transparent 60%);
  pointer-events: none; z-index: 0;
}
body::after {
  content: ''; position: fixed; top: 120px; right: -300px;
  width: 700px; height: 700px;
  background: radial-gradient(circle, rgba(93,79,255,0.06), transparent 60%);
  pointer-events: none; z-index: 0;
}

::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.06); border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.12); }

/* === Titlebar === */
.titlebar {
  -webkit-app-region: drag;
  height: 34px; flex-shrink: 0;
  position: relative; z-index: 2;
}

/* === Shell === */
.shell {
  flex: 1; overflow-y: auto;
  position: relative; z-index: 1;
  -webkit-app-region: no-drag;
}
.container {
  max-width: 1080px;
  width: 100%;
  margin: 0 auto;
  padding: 24px 56px 96px;
}

/* === Hero === */
.hero {
  display: flex; flex-direction: column;
  align-items: center; text-align: center;
  padding: 32px 0 56px;
}
.brand-row {
  display: inline-flex; align-items: center;
  gap: 12px; padding: 6px 14px 6px 8px;
  border-radius: 999px;
  background: rgba(255,255,255,0.03);
  border: 1px solid rgba(255,255,255,0.06);
  margin-bottom: 28px;
}
.brand-icon {
  width: 26px; height: 26px;
  display: flex; align-items: center; justify-content: center;
  color: #33afbc;
}
.brand-name {
  font-size: 13px; font-weight: 600;
  letter-spacing: -0.2px; color: #e6e8ed;
}
.brand-version {
  font-size: 11px; color: #525c6b;
  font-family: ui-monospace, 'SF Mono', Monaco, monospace;
  padding-left: 10px;
  border-left: 1px solid rgba(255,255,255,0.08);
}
.hero-headline {
  font-size: 40px; font-weight: 600;
  letter-spacing: -1.4px; line-height: 1.05;
  margin-bottom: 14px;
  background: linear-gradient(180deg, #ffffff 0%, #8b95a5 100%);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}
.hero-tagline {
  font-size: 14px; color: #8b95a5;
  font-weight: 400; max-width: 480px;
  line-height: 1.5;
}

/* === Error === */
.error-msg {
  display: none;
  max-width: 720px;
  margin: 0 auto 20px;
  padding: 11px 14px;
  border-radius: 8px;
  background: rgba(251,191,36,0.06);
  border: 1px solid rgba(251,191,36,0.22);
  color: #fbbf24;
  font-size: 12px;
}
.error-msg.active { display: block; }

/* === Landing grid === */
.landing-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 340px;
  gap: 32px;
  margin-bottom: 40px;
}
@media (max-width: 900px) {
  .landing-grid { grid-template-columns: 1fr; }
}

.col-title {
  font-size: 10px; font-weight: 600;
  text-transform: uppercase; letter-spacing: 1.4px;
  color: #525c6b;
  font-family: ui-monospace, 'SF Mono', Monaco, monospace;
  margin-bottom: 14px;
  padding-left: 2px;
}

/* === Featured card === */
.featured {
  display: flex; align-items: center;
  gap: 18px; width: 100%;
  padding: 22px 24px;
  border-radius: 12px;
  background: linear-gradient(135deg, rgba(51,175,188,0.10) 0%, rgba(51,175,188,0.02) 100%);
  border: 1px solid rgba(51,175,188,0.25);
  cursor: pointer; text-align: left;
  font-family: inherit; color: inherit;
  transition: transform 0.15s ease, border-color 0.15s, background 0.2s;
  position: relative; overflow: hidden;
  -webkit-app-region: no-drag;
}
.featured::before {
  content: ''; position: absolute; inset: 0;
  background: radial-gradient(circle at top right, rgba(51,175,188,0.18), transparent 55%);
  opacity: 0; transition: opacity 0.25s;
  pointer-events: none;
}
.featured:hover::before { opacity: 1; }
.featured:hover {
  border-color: rgba(51,175,188,0.55);
  transform: translateY(-1px);
}
.featured-ic {
  width: 48px; height: 48px;
  border-radius: 11px;
  background: rgba(51,175,188,0.16);
  color: #33afbc;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
  box-shadow: 0 0 0 1px rgba(51,175,188,0.12) inset;
}
.featured-body { flex: 1; min-width: 0; position: relative; z-index: 1; }
.featured-title {
  font-size: 16px; font-weight: 600;
  letter-spacing: -0.2px; color: #e6e8ed;
  margin-bottom: 4px;
}
.featured-sub {
  font-size: 12.5px; color: #8b95a5;
  line-height: 1.4;
}
.featured-kbd {
  display: inline-flex; align-items: center;
  padding: 5px 10px; border-radius: 6px;
  background: rgba(0,0,0,0.35);
  border: 1px solid rgba(255,255,255,0.08);
  color: #b0b8c4;
  font-family: ui-monospace, 'SF Mono', Monaco, monospace;
  font-size: 11px; font-weight: 500;
  flex-shrink: 0; position: relative; z-index: 1;
}

/* === Tile grid === */
.tile-row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  margin-top: 10px;
}
.tile {
  display: flex; flex-direction: column;
  align-items: flex-start;
  padding: 18px 16px 16px;
  border-radius: 10px;
  background: #12151b;
  border: 1px solid #1e232c;
  cursor: pointer; text-align: left;
  font-family: inherit; color: inherit;
  transition: transform 0.15s ease, border-color 0.15s, background 0.15s;
  -webkit-app-region: no-drag;
  position: relative;
}
.tile:hover {
  background: #161a21;
  border-color: #2c313a;
  transform: translateY(-1px);
}
.tile-ic {
  width: 34px; height: 34px;
  border-radius: 8px;
  background: rgba(255,255,255,0.035);
  color: #8b95a5;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
  margin-bottom: 14px;
  transition: color 0.15s, background 0.15s;
}
.tile:hover .tile-ic {
  color: #33afbc;
  background: rgba(51,175,188,0.10);
}
.tile-title {
  font-size: 13px; font-weight: 500;
  color: #e6e8ed; margin-bottom: 3px;
  letter-spacing: -0.1px;
}
.tile-sub {
  font-size: 11.5px; color: #525c6b;
  line-height: 1.4;
}
.tile-ext {
  position: absolute; top: 14px; right: 14px;
  color: #353b46;
  opacity: 0; transition: opacity 0.15s, color 0.15s;
}
.tile:hover .tile-ext { opacity: 1; color: #8b95a5; }

/* === Activity column === */
.activity-section { margin-bottom: 18px; }
.list-card {
  background: #12151b;
  border: 1px solid #1e232c;
  border-radius: 10px;
  padding: 5px;
}
.list-row {
  display: flex; align-items: center;
  padding: 9px 10px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.1s;
  -webkit-app-region: no-drag;
  position: relative;
}
.list-row:hover { background: rgba(255,255,255,0.04); }
.list-info { flex: 1; min-width: 0; }
.list-name {
  font-size: 12.5px; font-weight: 500;
  color: #b0b8c4;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  transition: color 0.1s;
}
.list-row:hover .list-name { color: #e6e8ed; }
.list-delete {
  opacity: 0; width: 22px; height: 22px;
  border: none; background: transparent;
  color: #525c6b; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  border-radius: 4px; flex-shrink: 0;
  transition: opacity 0.1s, color 0.1s, background 0.1s;
  font-family: inherit;
}
.list-row:hover .list-delete { opacity: 1; }
.list-delete:hover {
  color: #ef4444;
  background: rgba(239,68,68,0.10);
}

.empty-card {
  padding: 28px 20px;
  border-radius: 10px;
  background: rgba(255,255,255,0.015);
  border: 1px dashed #1e232c;
  text-align: center;
}
.empty-card-icon {
  width: 36px; height: 36px;
  margin: 0 auto 12px;
  display: flex; align-items: center; justify-content: center;
  color: #353b46;
}
.empty-card-title {
  font-size: 12px;
  color: #8b95a5;
  margin-bottom: 4px;
  font-weight: 500;
}
.empty-card-sub {
  font-size: 11px;
  color: #353b46;
  font-family: ui-monospace, 'SF Mono', Monaco, monospace;
  line-height: 1.5;
}

/* === What's New === */
.whats-new {
  padding: 22px 26px;
  border-radius: 12px;
  background: linear-gradient(180deg, rgba(255,255,255,0.025), rgba(255,255,255,0.005));
  border: 1px solid rgba(255,255,255,0.06);
  margin-bottom: 24px;
}
.whats-new-head {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 14px;
}
.whats-new-tag {
  display: inline-flex; align-items: center; gap: 7px;
  font-size: 10px; font-weight: 600;
  text-transform: uppercase; letter-spacing: 1.4px;
  color: #33afbc;
  font-family: ui-monospace, 'SF Mono', Monaco, monospace;
}
.whats-new-tag::before {
  content: ''; width: 6px; height: 6px;
  border-radius: 50%; background: #33afbc;
  box-shadow: 0 0 10px rgba(51,175,188,0.8);
}
.whats-new-ver {
  font-size: 11px; color: #525c6b;
  font-family: ui-monospace, 'SF Mono', Monaco, monospace;
}
.whats-new-list {
  list-style: none;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px 24px;
}
@media (max-width: 720px) {
  .whats-new-list { grid-template-columns: 1fr; }
}
.whats-new-list li {
  font-size: 12.5px; color: #b0b8c4;
  line-height: 1.5;
  padding-left: 16px;
  position: relative;
}
.whats-new-list li::before {
  content: ''; position: absolute; left: 0; top: 7px;
  width: 6px; height: 6px; border-radius: 2px;
  background: #2c313a;
}

/* === Footer === */
.footer-bar {
  flex-shrink: 0;
  height: 32px;
  padding: 0 24px;
  display: flex; align-items: center; justify-content: space-between;
  border-top: 1px solid rgba(255,255,255,0.05);
  background: rgba(10,12,16,0.6);
  backdrop-filter: blur(12px);
  position: relative; z-index: 2;
}
.kbd-hint {
  display: inline-flex; align-items: center; gap: 7px;
  font-size: 11px; color: #525c6b;
}
.kbd-hint kbd {
  display: inline-block; padding: 2px 6px;
  border-radius: 4px;
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.08);
  color: #8b95a5;
  font-family: ui-monospace, 'SF Mono', Monaco, monospace;
  font-size: 10px; font-weight: 500;
}
.footer-version {
  font-size: 11px; color: #353b46;
  font-family: ui-monospace, 'SF Mono', Monaco, monospace;
}

/* === Loading overlay === */
.loading-full {
  display: none; position: fixed; inset: 0;
  background: rgba(10,12,16,0.94);
  backdrop-filter: blur(10px);
  flex-direction: column; align-items: center; justify-content: center;
  gap: 18px; z-index: 100;
}
.loading-full.active { display: flex; }
.spinner {
  width: 26px; height: 26px;
  border: 2px solid rgba(255,255,255,0.08);
  border-top-color: #33afbc; border-radius: 50%;
  animation: spin 0.7s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
.loading-text {
  font-size: 12px; color: #8b95a5; font-weight: 500;
  font-family: ui-monospace, 'SF Mono', Monaco, monospace;
  letter-spacing: 0.2px;
}

/* === Update banner === */
.update-banner {
  display: none; position: fixed;
  left: 0; right: 0; bottom: 0;
  padding: 14px 32px; z-index: 40;
  background: rgba(10,12,16,0.96);
  border-top: 1px solid rgba(255,255,255,0.06);
  backdrop-filter: blur(12px);
  -webkit-app-region: no-drag;
}
.update-banner.active { display: block; }
.update-inner {
  display: flex; align-items: center; gap: 14px;
  max-width: 720px; margin: 0 auto;
}
.update-ic {
  width: 32px; height: 32px;
  border-radius: 8px;
  background: rgba(51,175,188,0.12);
  color: #33afbc;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.update-title {
  font-size: 12.5px; font-weight: 600; color: #e6e8ed;
  letter-spacing: -0.1px;
}
.update-detail {
  font-size: 11px; color: #8b95a5; margin-top: 2px;
}
.update-info { flex: 1; min-width: 0; }
.update-action {
  display: none;
  font-size: 11.5px; font-weight: 600;
  color: #0a0c10;
  background: #33afbc;
  padding: 7px 14px; border-radius: 6px;
  border: none;
  white-space: nowrap; cursor: pointer;
  transition: opacity 0.12s;
  font-family: inherit;
}
.update-action:hover { opacity: 0.88; }
.update-progress-bar {
  margin-top: 10px; height: 2px; border-radius: 1px;
  background: rgba(255,255,255,0.06); overflow: hidden;
  max-width: 720px; margin-left: auto; margin-right: auto;
}
.update-progress-fill {
  height: 100%; width: 0%;
  background: linear-gradient(90deg, #33afbc, #5d4fff);
  transition: width 0.4s ease-out;
}

/* === Panels (wizard / create project) === */
.panel-wrap {
  max-width: 600px;
  margin: 32px auto 0;
  padding: 32px 36px;
  background: #12151b;
  border: 1px solid #1e232c;
  border-radius: 14px;
  position: relative;
}
.panel-header {
  display: flex; align-items: center; gap: 12px;
  margin-bottom: 28px;
}
.panel-header-ic {
  width: 36px; height: 36px;
  border-radius: 9px;
  background: rgba(51,175,188,0.10);
  color: #33afbc;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.panel-header-text {
  font-size: 17px;
  font-weight: 600;
  letter-spacing: -0.3px;
  color: #e6e8ed;
}

.step-bar {
  display: flex; align-items: center;
  margin-bottom: 30px;
}
.step-col {
  display: flex; flex-direction: column; align-items: center;
  flex-shrink: 0; width: 60px;
}
.step-circle {
  width: 26px; height: 26px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 11px; font-weight: 600;
  border: 1.5px solid #2c313a; color: #525c6b; background: #0a0c10;
  transition: all 0.2s; flex-shrink: 0;
}
.step-circle.active {
  border-color: #33afbc; color: #33afbc;
  background: rgba(51,175,188,0.06);
  box-shadow: 0 0 0 4px rgba(51,175,188,0.08);
}
.step-circle.completed {
  border-color: #33afbc; color: #0a0c10; background: #33afbc;
}
.step-line {
  flex: 1; height: 1.5px; background: #1e232c; min-width: 12px;
  transition: background 0.2s;
}
.step-line.completed { background: #33afbc; }
.step-label {
  font-size: 9px; font-weight: 500;
  color: #525c6b; margin-top: 6px;
  text-transform: uppercase; letter-spacing: 0.6px;
  text-align: center; white-space: nowrap;
  font-family: ui-monospace, 'SF Mono', Monaco, monospace;
}

.wizard-field { margin-bottom: 18px; }
.wizard-field label {
  display: block; font-size: 10.5px; font-weight: 500;
  color: #8b95a5; margin-bottom: 6px;
  text-transform: uppercase; letter-spacing: 0.6px;
  font-family: ui-monospace, 'SF Mono', Monaco, monospace;
}
.wizard-input,
.wizard-input-mono {
  width: 100%; height: 38px; padding: 0 13px;
  border-radius: 7px;
  background: #0a0c10;
  border: 1px solid #1e232c;
  color: #e6e8ed; font-size: 13px;
  outline: none;
  transition: border-color 0.15s, background 0.15s;
}
.wizard-input {
  font-family: -apple-system, BlinkMacSystemFont, 'Inter', system-ui, sans-serif;
}
.wizard-input-mono {
  font-family: ui-monospace, 'SF Mono', Monaco, monospace;
}
.wizard-input:focus,
.wizard-input-mono:focus {
  border-color: #33afbc;
  background: #0d1015;
}
.wizard-input::placeholder,
.wizard-input-mono::placeholder { color: #353b46; }
.wizard-input-short { max-width: 140px; }
.wizard-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.wizard-card {
  padding: 0; border-radius: 8px;
  background: #0d1015;
  border: 1px solid #1e232c;
}
.wizard-btn-primary {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  height: 36px; padding: 0 18px;
  border-radius: 7px;
  background: #33afbc; border: none;
  color: #0a0c10; font-size: 12.5px; font-weight: 600;
  cursor: pointer;
  font-family: inherit;
  transition: opacity 0.12s, transform 0.12s;
  letter-spacing: 0.1px;
}
.wizard-btn-primary:hover { opacity: 0.9; }
.wizard-btn-primary:active { transform: translateY(1px); }
.wizard-btn-primary:disabled {
  opacity: 0.3; cursor: not-allowed; transform: none;
}
.wizard-btn-secondary {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  height: 36px; padding: 0 16px;
  border-radius: 7px;
  background: transparent;
  border: 1px solid #2c313a;
  color: #8b95a5; font-size: 12.5px; font-weight: 500;
  cursor: pointer; font-family: inherit;
  transition: border-color 0.12s, color 0.12s, background 0.12s;
}
.wizard-btn-secondary:hover {
  border-color: #3e4451; color: #e6e8ed;
  background: rgba(255,255,255,0.025);
}
.wizard-actions {
  display: flex; gap: 8px; justify-content: flex-end;
  margin-top: 22px;
}
.wizard-actions-split { justify-content: space-between; }
.wizard-actions-group { display: flex; gap: 8px; }

.test-result {
  margin-top: 14px; padding: 12px 14px;
  border-radius: 7px;
  background: #0d1015;
  border: 1px solid #1e232c;
  font-size: 12px;
}
.test-dot {
  display: inline-block; width: 6px; height: 6px;
  border-radius: 50%;
  margin-right: 9px; vertical-align: middle;
}
.test-dot.green { background: #33afbc; box-shadow: 0 0 6px rgba(51,175,188,0.6); }
.test-dot.red { background: #ef4444; }
.test-dot.yellow { background: #fbbf24; }
.test-row { padding: 3px 0; color: #b0b8c4; }

.toggle-track {
  width: 34px; height: 20px; border-radius: 10px;
  background: #2c313a; cursor: pointer;
  position: relative; transition: background 0.2s;
  flex-shrink: 0; border: none;
}
.toggle-track.on { background: #33afbc; }
.toggle-track::after {
  content: ''; position: absolute;
  top: 2px; left: 2px;
  width: 16px; height: 16px;
  border-radius: 50%; background: #ffffff;
  transition: transform 0.2s;
}
.toggle-track.on::after { transform: translateX(14px); }
.toggle-row {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 16px;
}
.toggle-row:first-child { border-bottom: 1px solid #1e232c; }
.toggle-label { font-size: 12.5px; color: #b0b8c4; }

.success-panel { text-align: center; padding: 32px 20px 20px; }
.success-check {
  width: 56px; height: 56px; border-radius: 50%;
  background: rgba(51,175,188,0.10);
  border: 1px solid rgba(51,175,188,0.25);
  display: inline-flex; align-items: center; justify-content: center;
  margin-bottom: 18px;
  box-shadow: 0 0 0 6px rgba(51,175,188,0.04);
}
.success-title {
  font-size: 17px; font-weight: 600;
  color: #e6e8ed; margin-bottom: 5px;
  letter-spacing: -0.2px;
}
.success-sub {
  font-size: 12px; color: #8b95a5;
  margin-bottom: 26px;
  font-family: ui-monospace, 'SF Mono', Monaco, monospace;
}
.success-actions {
  display: flex; gap: 8px; justify-content: center;
}

.wizard-summary {
  margin-top: 14px; padding: 12px 14px;
  border-radius: 7px;
  background: #0d1015;
  border: 1px solid #1e232c;
  font-size: 12px;
}
.wizard-summary-row {
  display: flex; justify-content: space-between;
  padding: 4px 0;
}
.wizard-summary-label {
  color: #525c6b; font-size: 11px;
  text-transform: uppercase; letter-spacing: 0.4px;
  font-family: ui-monospace, 'SF Mono', Monaco, monospace;
}
.wizard-summary-val {
  font-family: ui-monospace, 'SF Mono', Monaco, monospace;
  color: #e6e8ed; font-size: 12px;
}
.browse-row { display: flex; gap: 8px; align-items: center; }
.browse-row .wizard-input-mono { flex: 1; }
.selected-path {
  margin-top: 6px; font-size: 11px;
  color: #525c6b;
  font-family: ui-monospace, 'SF Mono', Monaco, monospace;
  word-break: break-all;
}
</style>
</head>
<body>
<div class="titlebar"></div>

<div class="shell">
  <div class="container">

    <!-- Hero -->
    <section class="hero">
      <div class="brand-row">
        <div class="brand-icon">
          <svg width="26" height="14" viewBox="0 6 24 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 12c-2-2.67-4-4-6-4a4 4 0 1 0 0 8c2 0 4-1.33 6-4Zm0 0c2 2.67 4 4 6 4a4 4 0 0 0 0-8c-2 0-4 1.33-6 4Z"/></svg>
        </div>
        <span class="brand-name">Groove</span>
        <span class="brand-version" id="version"></span>
      </div>
      <h1 class="hero-headline">Spawn fast. Stay aware.</h1>
      <p class="hero-tagline">Agent orchestration for AI coding tools. Choose a project to get started, or connect to a remote machine.</p>
    </section>

    <div class="error-msg" id="error"></div>

    <!-- Landing -->
    <div id="main-actions">
      <div class="landing-grid">

        <!-- Start column -->
        <div class="col-start">
          <div class="col-title">Start</div>

          <button class="featured" id="open-folder">
            <div class="featured-ic">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
            </div>
            <div class="featured-body">
              <div class="featured-title">Open Project</div>
              <div class="featured-sub">Select a local folder to start a team</div>
            </div>
            <span class="featured-kbd" id="kbd-open">⌘O</span>
          </button>

          <div class="tile-row">
            <button class="tile" id="btn-ssh-wizard">
              <div class="tile-ic">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/><path d="m7 10 2 2-2 2"/><path d="M13 14h4"/></svg>
              </div>
              <div class="tile-title">New SSH</div>
              <div class="tile-sub">Connect to remote</div>
            </button>

            <button class="tile" id="btn-create-project">
              <div class="tile-ic">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 10v6"/><path d="M9 13h6"/><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
              </div>
              <div class="tile-title">Create Project</div>
              <div class="tile-sub">New directory</div>
            </button>

            <button class="tile" id="btn-docs">
              <div class="tile-ic">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M16 13H8M16 17H8M10 9H8"/></svg>
              </div>
              <div class="tile-title">Documentation</div>
              <div class="tile-sub">Learn the basics</div>
              <svg class="tile-ext" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17L17 7"/><path d="M7 7h10v10"/></svg>
            </button>
          </div>
        </div>

        <!-- Activity column -->
        <div class="col-activity">
          <div class="activity-section" id="recents-section" style="display:none">
            <div class="col-title">Recent</div>
            <div class="list-card" id="recents"></div>
          </div>

          <div class="activity-section" id="ssh-section" style="display:none">
            <div class="col-title">SSH Connections</div>
            <div class="list-card" id="ssh-list"></div>
          </div>

          <div id="empty-state" style="display:none">
            <div class="col-title">Activity</div>
            <div class="empty-card">
              <div class="empty-card-icon">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 2"/></svg>
              </div>
              <div class="empty-card-title">No recent activity</div>
              <div class="empty-card-sub">Open a project or connect to a server</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- What's New -->
    <div class="whats-new" id="whats-new">
      <div class="whats-new-head">
        <span class="whats-new-tag">What's New</span>
        <span class="whats-new-ver" id="version-whats-new"></span>
      </div>
      <ul class="whats-new-list">
        <li>Local model engine — run agents on GGUF, Ollama, llama-server</li>
        <li>HuggingFace model browser with one-click download</li>
        <li>MCP integrations — Slack, Gmail, Stripe, 15+ services</li>
        <li>Agent scheduling with cron expressions</li>
      </ul>
    </div>

    <!-- SSH Wizard -->
    <div id="ssh-wizard" style="display:none">
      <div class="panel-wrap">
        <div class="panel-header">
          <div class="panel-header-ic">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="m7 10 2 2-2 2"/><path d="M13 14h4"/></svg>
          </div>
          <span class="panel-header-text">New SSH Connection</span>
        </div>
        <div class="step-bar" id="step-bar">
          <div class="step-col"><div class="step-circle active" id="sc-0">1</div><div class="step-label">Server</div></div>
          <div class="step-line" id="sl-0"></div>
          <div class="step-col"><div class="step-circle" id="sc-1">2</div><div class="step-label">Auth</div></div>
          <div class="step-line" id="sl-1"></div>
          <div class="step-col"><div class="step-circle" id="sc-2">3</div><div class="step-label">Setup</div></div>
          <div class="step-line" id="sl-2"></div>
          <div class="step-col"><div class="step-circle" id="sc-3">4</div><div class="step-label">Done</div></div>
        </div>

        <div class="wizard-step" id="ws-0">
          <div class="wizard-field">
            <label>Connection Name</label>
            <input type="text" class="wizard-input" id="wiz-name" placeholder="My Server">
          </div>
          <div class="wizard-grid">
            <div class="wizard-field">
              <label>Host</label>
              <input type="text" class="wizard-input-mono" id="wiz-host" placeholder="192.168.1.100">
            </div>
            <div class="wizard-field">
              <label>User</label>
              <input type="text" class="wizard-input-mono" id="wiz-user" placeholder="root">
            </div>
          </div>
          <div class="wizard-field">
            <label>Port</label>
            <input type="number" class="wizard-input-mono wizard-input-short" id="wiz-port" value="22" min="1" max="65535">
          </div>
          <div class="wizard-actions">
            <button class="wizard-btn-secondary" id="wiz-cancel-0">Cancel</button>
            <button class="wizard-btn-primary" id="wiz-next-0" disabled>Continue</button>
          </div>
        </div>

        <div class="wizard-step" id="ws-1" style="display:none">
          <div class="wizard-field">
            <label>SSH Key Path</label>
            <div class="browse-row">
              <input type="text" class="wizard-input-mono" id="wiz-key" placeholder="~/.ssh/id_ed25519" readonly>
              <button class="wizard-btn-secondary" id="wiz-browse">Browse</button>
            </div>
          </div>
          <div class="wizard-actions wizard-actions-split">
            <button class="wizard-btn-secondary" id="wiz-test">Test Connection</button>
            <div class="wizard-actions-group">
              <button class="wizard-btn-secondary" id="wiz-back-1">Back</button>
              <button class="wizard-btn-primary" id="wiz-next-1">Continue</button>
            </div>
          </div>
          <div id="wiz-test-result"></div>
        </div>

        <div class="wizard-step" id="ws-2" style="display:none">
          <div class="wizard-card">
            <div class="toggle-row">
              <span class="toggle-label">Auto-start daemon</span>
              <button class="toggle-track" id="wiz-toggle-autostart"></button>
            </div>
            <div class="toggle-row">
              <span class="toggle-label">Auto-connect on launch</span>
              <button class="toggle-track" id="wiz-toggle-autoconnect"></button>
            </div>
          </div>
          <div class="wizard-summary" id="wiz-summary"></div>
          <div class="wizard-actions">
            <button class="wizard-btn-secondary" id="wiz-back-2">Back</button>
            <button class="wizard-btn-primary" id="wiz-connect">Connect</button>
          </div>
        </div>

        <div class="wizard-step" id="ws-3" style="display:none">
          <div class="success-panel">
            <div class="success-check">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#33afbc" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
            </div>
            <div class="success-title" id="wiz-success-title">Connected</div>
            <div class="success-sub" id="wiz-success-sub"></div>
            <div class="success-actions">
              <button class="wizard-btn-primary" id="wiz-open-remote">Open Remote GUI</button>
              <button class="wizard-btn-secondary" id="wiz-done">Done</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Create Project -->
    <div id="create-project" style="display:none">
      <div class="panel-wrap">
        <div class="panel-header">
          <div class="panel-header-ic">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 10v6"/><path d="M9 13h6"/><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
          </div>
          <span class="panel-header-text">Create New Project</span>
        </div>
        <div class="wizard-field">
          <label>Location</label>
          <div class="browse-row">
            <input type="text" class="wizard-input-mono" id="cp-path" placeholder="Choose a folder..." readonly>
            <button class="wizard-btn-secondary" id="cp-browse">Choose</button>
          </div>
          <div class="selected-path" id="cp-path-display"></div>
        </div>
        <div class="wizard-field">
          <label>Project Name</label>
          <input type="text" class="wizard-input" id="cp-name" placeholder="my-project">
        </div>
        <div class="wizard-actions">
          <button class="wizard-btn-secondary" id="cp-cancel">Cancel</button>
          <button class="wizard-btn-primary" id="cp-create" disabled>Create &amp; Open</button>
        </div>
      </div>
    </div>

  </div>
</div>

<!-- Footer -->
<div class="footer-bar">
  <span class="kbd-hint"><kbd id="kbd-footer">⌘O</kbd> Open Project</span>
  <span class="footer-version">groove · agent orchestration</span>
</div>

<!-- Update banner -->
<div class="update-banner" id="update-btn">
  <div class="update-inner">
    <div class="update-ic">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m16 12-4-4-4 4"/><path d="M12 16V8"/></svg>
    </div>
    <div class="update-info">
      <div class="update-title" id="update-title">Update Available</div>
      <div class="update-detail" id="update-detail">Downloading...</div>
    </div>
    <button class="update-action" id="update-action">Update &amp; Restart</button>
  </div>
  <div class="update-progress-bar" id="update-progress-bar">
    <div class="update-progress-fill" id="update-progress-fill"></div>
  </div>
</div>

<!-- Loading overlay -->
<div class="loading-full" id="loading">
  <div class="spinner"></div>
  <div class="loading-text" id="loading-text">Starting Groove...</div>
</div>

<script>
(function() {
  var X_IC = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"' +
    ' stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function setLoading(on, text) {
    document.getElementById('loading').className = on ? 'loading-full active' : 'loading-full';
    if (text) document.getElementById('loading-text').textContent = text;
  }

  function showError(msg) {
    var el = document.getElementById('error');
    el.textContent = msg;
    el.className = 'error-msg active';
  }

  function hideError() {
    document.getElementById('error').className = 'error-msg';
  }

  function openProject(dir) {
    setLoading(true, 'Opening ' + dir.split(/[\\/]/).pop() + '...');
    hideError();
    window.groove.home.openRecent(dir).catch(function(err) {
      setLoading(false);
      showError(err.message || 'Failed to open project');
    });
  }

  if (window.groove.platform !== 'darwin') {
    var k1 = document.getElementById('kbd-open');
    var k2 = document.getElementById('kbd-footer');
    if (k1) k1.textContent = 'Ctrl+O';
    if (k2) k2.textContent = 'Ctrl+O';
  }

  // --- View navigation ---
  var actionsEl = document.getElementById('main-actions');
  var whatsNewEl = document.getElementById('whats-new');
  var sshWizardEl = document.getElementById('ssh-wizard');
  var createProjectEl = document.getElementById('create-project');

  function showMainMenu() {
    actionsEl.style.display = '';
    if (whatsNewEl) whatsNewEl.style.display = '';
    sshWizardEl.style.display = 'none';
    createProjectEl.style.display = 'none';
    hideError();
  }

  function showSSHWizard() {
    actionsEl.style.display = 'none';
    if (whatsNewEl) whatsNewEl.style.display = 'none';
    sshWizardEl.style.display = '';
    createProjectEl.style.display = 'none';
    hideError();
    wizardStep = 0;
    wizardData = { name: '', host: '', user: '', port: 22, sshKeyPath: '', autoStart: false, autoConnect: false };
    testResult = null;
    savedId = null;
    localPort = null;
    document.getElementById('wiz-name').value = '';
    document.getElementById('wiz-host').value = '';
    document.getElementById('wiz-user').value = '';
    document.getElementById('wiz-port').value = '22';
    document.getElementById('wiz-key').value = '';
    document.getElementById('wiz-test-result').innerHTML = '';
    document.getElementById('wiz-toggle-autostart').className = 'toggle-track';
    document.getElementById('wiz-toggle-autoconnect').className = 'toggle-track';
    setWizardStep(0);
  }

  function showCreateProject() {
    actionsEl.style.display = 'none';
    if (whatsNewEl) whatsNewEl.style.display = 'none';
    sshWizardEl.style.display = 'none';
    createProjectEl.style.display = '';
    hideError();
    cpParentPath = '';
    document.getElementById('cp-path').value = '';
    document.getElementById('cp-path-display').textContent = '';
    document.getElementById('cp-name').value = '';
    document.getElementById('cp-create').disabled = true;
  }

  document.getElementById('open-folder').addEventListener('click', function() {
    hideError();
    window.groove.home.openFolder().then(function(dir) {
      if (dir) openProject(dir);
    }).catch(function(err) {
      showError(err.message || 'Failed to open folder');
    });
  });

  document.getElementById('btn-ssh-wizard').addEventListener('click', showSSHWizard);
  document.getElementById('btn-create-project').addEventListener('click', showCreateProject);

  document.getElementById('btn-docs').addEventListener('click', function() {
    if (window.groove.openExternal) {
      window.groove.openExternal('https://docs.groovedev.ai');
    }
  });

  window.groove.getVersion().then(function(v) {
    document.getElementById('version').textContent = 'v' + v;
    var wnv = document.getElementById('version-whats-new');
    if (wnv) wnv.textContent = 'v' + v;
  }).catch(function() {});

  if (window.groove.update) {
    var updateBtn = document.getElementById('update-btn');
    var updateTitle = document.getElementById('update-title');
    var updateDetail = document.getElementById('update-detail');
    var updateAction = document.getElementById('update-action');
    var progressFill = document.getElementById('update-progress-fill');
    var progressBar = document.getElementById('update-progress-bar');

    if (window.groove.update.onUpdateProgress) {
      window.groove.update.onUpdateProgress(function(data) {
        updateBtn.classList.add('active');
        updateDetail.textContent = 'Downloading… ' + (data.percent || 0) + '%';
        progressFill.style.width = (data.percent || 0) + '%';
      });
    }
    window.groove.update.onUpdateDownloaded(function(data) {
      updateBtn.classList.add('active');
      updateTitle.textContent = 'v' + data.version + ' Ready';
      updateDetail.textContent = 'Restart to apply the update';
      progressBar.style.display = 'none';
      updateAction.style.display = 'inline-flex';
      updateAction.onclick = function(e) {
        e.stopPropagation();
        window.groove.update.installUpdate();
      };
      updateBtn.onclick = function() { window.groove.update.installUpdate(); };
    });
  }

  // --- Recents ---
  var recentsData = [];
  var recentsEl = document.getElementById('recents');
  var recentsSec = document.getElementById('recents-section');
  var emptyEl = document.getElementById('empty-state');

  function renderRecents(recents) {
    recentsData = recents || [];
    if (!recentsData.length) {
      recentsSec.style.display = 'none';
      checkEmpty();
      return;
    }
    recentsSec.style.display = '';
    var items = recentsData.slice(0, 8);
    recentsEl.innerHTML = items.map(function(r) {
      return '<div class="list-row" data-dir="' + esc(r.dir) + '" title="' + esc(r.dir) + '">' +
        '<div class="list-info">' +
          '<div class="list-name">' + esc(r.name || r.dir.split(/[\\/]/).pop()) + '</div>' +
        '</div>' +
        '<button class="list-delete" data-del-dir="' + esc(r.dir) + '" title="Remove from recents">' + X_IC + '</button>' +
      '</div>';
    }).join('');
    recentsEl.querySelectorAll('.list-row').forEach(function(el) {
      el.addEventListener('click', function(e) {
        if (e.target.closest('.list-delete')) return;
        openProject(el.getAttribute('data-dir'));
      });
    });
    recentsEl.querySelectorAll('.list-delete').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        var dir = btn.getAttribute('data-del-dir');
        window.groove.home.removeRecent(dir).then(function(updated) {
          renderRecents(updated);
        }).catch(function() {
          recentsData = recentsData.filter(function(r) { return r.dir !== dir; });
          renderRecents(recentsData);
        });
      });
    });
    checkEmpty();
  }

  window.groove.home.getRecents().then(renderRecents).catch(function(err) {
    showError('Failed to load recent projects: ' + err.message);
  });

  // --- SSH connections ---
  var sshData = [];
  var sshListEl = document.getElementById('ssh-list');
  var sshSection = document.getElementById('ssh-section');

  function checkEmpty() {
    var hasRecents = recentsData.length > 0;
    var hasSSH = sshData.length > 0;
    emptyEl.style.display = (!hasRecents && !hasSSH) ? '' : 'none';
  }

  function renderSSH(connections) {
    sshData = connections || [];
    if (!sshData.length) {
      sshSection.style.display = 'none';
      sshListEl.innerHTML = '';
      checkEmpty();
      return;
    }
    sshSection.style.display = '';
    sshListEl.innerHTML = sshData.slice(0, 5).map(function(c) {
      return '<div class="list-row" data-ssh-id="' + esc(c.id) + '">' +
        '<div class="list-info">' +
          '<div class="list-name">' + esc(c.name || c.host) + '</div>' +
        '</div>' +
        '<button class="list-delete" data-del-ssh="' + esc(c.id) + '" title="Remove connection">' + X_IC + '</button>' +
      '</div>';
    }).join('');
    sshListEl.querySelectorAll('.list-row').forEach(function(el) {
      el.addEventListener('click', function(e) {
        if (e.target.closest('.list-delete')) return;
        var id = el.getAttribute('data-ssh-id');
        var conn = sshData.find(function(c) { return c.id === id; });
        var label = conn ? (conn.name || conn.host) : 'server';
        setLoading(true, 'Connecting to ' + label + '…');
        hideError();
        window.groove.home.connectSSH(id).then(function(result) {
          return window.groove.remote.openWindow(result.localPort, result.name || label);
        }).catch(function(err) {
          setLoading(false);
          showError(err.message || 'Failed to connect');
        });
      });
    });
    sshListEl.querySelectorAll('.list-delete').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        var id = btn.getAttribute('data-del-ssh');
        window.groove.home.removeSSH(id).then(function(updated) {
          renderSSH(updated);
        }).catch(function() {
          sshData = sshData.filter(function(c) { return c.id !== id; });
          renderSSH(sshData);
        });
      });
    });
    checkEmpty();
  }

  window.groove.home.getSSH().then(renderSSH).catch(function() { renderSSH([]); });

  // --- SSH Wizard Logic ---
  var wizardStep = 0;
  var wizardData = { name: '', host: '', user: '', port: 22, sshKeyPath: '', autoStart: false, autoConnect: false };
  var testResult = null;
  var savedId = null;
  var localPort = null;

  function setWizardStep(n) {
    wizardStep = n;
    for (var i = 0; i < 4; i++) {
      var circle = document.getElementById('sc-' + i);
      circle.className = 'step-circle' + (i === n ? ' active' : (i < n ? ' completed' : ''));
      if (i < 3) {
        document.getElementById('sl-' + i).className = 'step-line' + (i < n ? ' completed' : '');
      }
      document.getElementById('ws-' + i).style.display = i === n ? '' : 'none';
    }
    if (n === 2) {
      var summary = document.getElementById('wiz-summary');
      summary.innerHTML =
        '<div class="wizard-summary-row"><span class="wizard-summary-label">Name</span><span class="wizard-summary-val">' + esc(wizardData.name) + '</span></div>' +
        '<div class="wizard-summary-row"><span class="wizard-summary-label">Server</span><span class="wizard-summary-val">' + esc(wizardData.user + '@' + wizardData.host + ':' + wizardData.port) + '</span></div>' +
        (wizardData.sshKeyPath ? '<div class="wizard-summary-row"><span class="wizard-summary-label">Key</span><span class="wizard-summary-val">' + esc(wizardData.sshKeyPath) + '</span></div>' : '');
    }
  }

  function checkStep0Valid() {
    var valid = document.getElementById('wiz-name').value.trim() &&
                document.getElementById('wiz-host').value.trim() &&
                document.getElementById('wiz-user').value.trim();
    document.getElementById('wiz-next-0').disabled = !valid;
  }

  document.getElementById('wiz-name').addEventListener('input', checkStep0Valid);
  document.getElementById('wiz-host').addEventListener('input', checkStep0Valid);
  document.getElementById('wiz-user').addEventListener('input', checkStep0Valid);

  document.getElementById('wiz-next-0').addEventListener('click', function() {
    wizardData.name = document.getElementById('wiz-name').value.trim();
    wizardData.host = document.getElementById('wiz-host').value.trim();
    wizardData.user = document.getElementById('wiz-user').value.trim();
    wizardData.port = parseInt(document.getElementById('wiz-port').value, 10) || 22;
    setWizardStep(1);
  });

  document.getElementById('wiz-cancel-0').addEventListener('click', showMainMenu);

  document.getElementById('wiz-browse').addEventListener('click', function() {
    window.groove.home.pickKeyFile().then(function(path) {
      if (path) {
        document.getElementById('wiz-key').value = path;
        wizardData.sshKeyPath = path;
      }
    });
  });

  document.getElementById('wiz-test').addEventListener('click', function() {
    var btn = document.getElementById('wiz-test');
    btn.disabled = true;
    btn.textContent = 'Testing…';
    wizardData.sshKeyPath = document.getElementById('wiz-key').value.trim();
    window.groove.home.testSSH({
      host: wizardData.host,
      user: wizardData.user,
      port: wizardData.port,
      sshKeyPath: wizardData.sshKeyPath
    }).then(function(result) {
      testResult = result;
      btn.disabled = false;
      btn.textContent = 'Test Connection';
      var el = document.getElementById('wiz-test-result');
      if (!result.reachable) {
        el.innerHTML = '<div class="test-result"><div class="test-row"><span class="test-dot red"></span>Connection failed: ' + esc(result.error || 'Unknown error') + '</div></div>';
        return;
      }
      var html = '<div class="test-result">';
      html += '<div class="test-row"><span class="test-dot green"></span>SSH connection successful</div>';
      html += '<div class="test-row"><span class="test-dot ' + (result.grooveInstalled ? 'green' : 'yellow') + '"></span>Groove ' + (result.grooveInstalled ? 'installed' : 'not found') + '</div>';
      html += '<div class="test-row"><span class="test-dot ' + (result.daemonRunning ? 'green' : 'yellow') + '"></span>Daemon ' + (result.daemonRunning ? 'running' : 'not running') + '</div>';
      html += '</div>';
      el.innerHTML = html;
    }).catch(function(err) {
      btn.disabled = false;
      btn.textContent = 'Test Connection';
      document.getElementById('wiz-test-result').innerHTML = '<div class="test-result"><div class="test-row"><span class="test-dot red"></span>' + esc(err.message || 'Test failed') + '</div></div>';
    });
  });

  document.getElementById('wiz-next-1').addEventListener('click', function() {
    wizardData.sshKeyPath = document.getElementById('wiz-key').value.trim();
    setWizardStep(2);
  });
  document.getElementById('wiz-back-1').addEventListener('click', function() { setWizardStep(0); });

  document.getElementById('wiz-toggle-autostart').addEventListener('click', function() {
    wizardData.autoStart = !wizardData.autoStart;
    this.className = 'toggle-track' + (wizardData.autoStart ? ' on' : '');
  });
  document.getElementById('wiz-toggle-autoconnect').addEventListener('click', function() {
    wizardData.autoConnect = !wizardData.autoConnect;
    this.className = 'toggle-track' + (wizardData.autoConnect ? ' on' : '');
  });

  document.getElementById('wiz-connect').addEventListener('click', function() {
    var btn = document.getElementById('wiz-connect');
    btn.disabled = true;
    btn.textContent = 'Connecting…';
    setLoading(true, 'Connecting to ' + wizardData.name + '…');
    var config = {
      name: wizardData.name,
      host: wizardData.host,
      user: wizardData.user,
      port: wizardData.port,
      sshKeyPath: wizardData.sshKeyPath,
      autoStart: wizardData.autoStart,
      autoConnect: wizardData.autoConnect
    };
    window.groove.home.addSSH(config).then(function(entry) {
      savedId = entry.id;
      return window.groove.home.connectSSH(entry.id);
    }).then(function(result) {
      localPort = result.localPort;
      setLoading(false);
      btn.disabled = false;
      btn.textContent = 'Connect';
      document.getElementById('wiz-success-title').textContent = 'Connected to ' + wizardData.name;
      document.getElementById('wiz-success-sub').textContent = wizardData.user + '@' + wizardData.host + ':' + wizardData.port;
      setWizardStep(3);
      window.groove.home.getSSH().then(renderSSH).catch(function() {});
    }).catch(function(err) {
      setLoading(false);
      btn.disabled = false;
      btn.textContent = 'Connect';
      showError(err.message || 'Failed to connect');
    });
  });

  document.getElementById('wiz-back-2').addEventListener('click', function() { setWizardStep(1); });

  document.getElementById('wiz-open-remote').addEventListener('click', function() {
    if (localPort) {
      window.groove.remote.openWindow(localPort, wizardData.name);
    }
  });

  document.getElementById('wiz-done').addEventListener('click', showMainMenu);

  // --- Create Project Logic ---
  var cpParentPath = '';

  function checkCreateValid() {
    var name = document.getElementById('cp-name').value.trim();
    var valid = cpParentPath && name && !/[/\\\\]/.test(name);
    document.getElementById('cp-create').disabled = !valid;
  }

  document.getElementById('cp-browse').addEventListener('click', function() {
    window.groove.home.openFolder().then(function(dir) {
      if (dir) {
        cpParentPath = dir;
        document.getElementById('cp-path').value = dir.split(/[\\/]/).pop();
        document.getElementById('cp-path-display').textContent = dir;
        checkCreateValid();
      }
    });
  });

  document.getElementById('cp-name').addEventListener('input', checkCreateValid);

  document.getElementById('cp-create').addEventListener('click', function() {
    var name = document.getElementById('cp-name').value.trim();
    if (!name || !cpParentPath) return;
    if (/[/\\\\]/.test(name)) {
      showError('Project name cannot contain / or \\\\');
      return;
    }
    setLoading(true, 'Creating ' + name + '…');
    window.groove.home.createDir(cpParentPath, name).then(function(fullPath) {
      openProject(fullPath);
    }).catch(function(err) {
      setLoading(false);
      showError(err.message || 'Failed to create directory');
    });
  });

  document.getElementById('cp-cancel').addEventListener('click', showMainMenu);

  // --- Keyboard shortcut ---
  document.addEventListener('keydown', function(e) {
    var mod = e.metaKey || e.ctrlKey;
    if (mod && (e.key === 'o' || e.key === 'O')) {
      e.preventDefault();
      document.getElementById('open-folder').click();
    }
  });
})();
</script>
</body>
</html>`;
}
