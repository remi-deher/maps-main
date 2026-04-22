const fs = require('fs');
const filepath = './renderer/css/app.css';
let css = fs.readFileSync(filepath, 'utf8');

const colors = {
  '#1a1a2e': '--bg-body',
  '#16213e': '--bg-panel',
  '#0f3460': '--border-color',
  '#e0e0e0': '--text-main',
  '#0f1b33': '--bg-input',
  '#6b7db3': '--text-muted',
  '#0a2a1a': '--bg-badge-success',
  '#4ade80': '--text-success',
  '#1a5c34': '--border-badge-success',
  '#0d3b2e': '--bg-badge-ready',
  '#2d2000': '--bg-badge-starting',
  '#fbbf24': '--text-warning',
  '#a0e0c0': '--text-sim-name',
  '#4a9a6a': '--text-sim-coords',
  '#4f8ef7': '--btn-primary',
  '#e74c3c': '--btn-danger',
  '#a0b4e0': '--text-btn-secondary',
  '#0f2050': '--bg-list-hover',
  '#2a4a8a': '--mark-bg',
  '#90c0ff': '--mark-text',
  '#0a1122': '--bg-log',
  'rgba\\\\(0, 0, 0, \\\\.6\\\\)': '--modal-overlay',
  '#1e293b': '--toast-bg',
  '#334': '--toast-border',
  '#f87171': '--text-error',
  '#60a5fa': '--text-info',
  '#94a3b8': '--text-debug',
  '#fff': '--text-white'
};

const vars = `:root {
  --bg-body: #1a1a2e;
  --bg-panel: #16213e;
  --border-color: #0f3460;
  --text-main: #e0e0e0;
  --bg-input: #0f1b33;
  --text-muted: #6b7db3;
  --bg-badge-success: #0a2a1a;
  --text-success: #4ade80;
  --border-badge-success: #1a5c34;
  --bg-badge-ready: #0d3b2e;
  --bg-badge-starting: #2d2000;
  --text-warning: #fbbf24;
  --text-sim-name: #a0e0c0;
  --text-sim-coords: #4a9a6a;
  --btn-primary: #4f8ef7;
  --btn-danger: #e74c3c;
  --text-btn-secondary: #a0b4e0;
  --bg-list-hover: #0f2050;
  --mark-bg: #2a4a8a;
  --mark-text: #90c0ff;
  --bg-log: #0a1122;
  --modal-overlay: rgba(0, 0, 0, .6);
  --toast-bg: #1e293b;
  --toast-border: #334;
  --text-error: #f87171;
  --text-info: #60a5fa;
  --text-debug: #94a3b8;
  --text-white: #fff;
}

[data-theme='light'] {
  --bg-body: #f8fafc;
  --bg-panel: #ffffff;
  --border-color: #cbd5e1;
  --text-main: #334155;
  --bg-input: #f1f5f9;
  --text-muted: #64748b;
  --bg-badge-success: #ecfdf5;
  --text-success: #059669;
  --border-badge-success: #a7f3d0;
  --bg-badge-ready: #ecfdf5;
  --bg-badge-starting: #fef3c7;
  --text-warning: #d97706;
  --text-sim-name: #0f766e;
  --text-sim-coords: #047857;
  --btn-primary: #3b82f6;
  --btn-danger: #ef4444;
  --text-btn-secondary: #475569;
  --bg-list-hover: #f1f5f9;
  --mark-bg: #bfdbfe;
  --mark-text: #1e40af;
  --bg-log: #f8fafc;
  --modal-overlay: rgba(0, 0, 0, .4);
  --toast-bg: #ffffff;
  --toast-border: #e2e8f0;
  --text-error: #dc2626;
  --text-info: #2563eb;
  --text-debug: #64748b;
  --text-white: #fff;
}
`;

for (const [hex, v] of Object.entries(colors)) {
  css = css.replace(new RegExp(hex, 'g'), `var(${v})`);
}

css = vars + '\n' + css;
fs.writeFileSync(filepath, css);
console.log('done');
