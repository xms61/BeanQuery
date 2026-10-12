/**
 * The app's stylesheet, served at /assets/app.css. The color tokens are the Figma variables ("BeanQuery color" and
 * "BeanQuery color dark"), so a screen here and its design use the same names. Fonts fall back to the system's until
 * the Familjen Grotesk and JetBrains Mono files are served from the app (see the tech-debt tracker).
 */
export const styleSheet = `
:root {
  color-scheme: light dark;
  --bg-ground: #EDEFE7;
  --bg-surface: #FAFBF7;
  --bg-sunk: #E3E6DC;
  --line-default: #D3D7CB;
  --line-strong: #B9BEB0;
  --ink-default: #2B201A;
  --ink-muted: #6B6259;
  --ink-faint: #9A9188;
  --ink-inverse: #FAFBF7;
  --accent-cherry: #B4232F;
  --phase-resting: #7D8796;
  --phase-resting-bg: #E2E6EA;
  --phase-rested: #C9952A;
  --phase-peak: #3F7246;
  --phase-peak-bg: #DCE9DA;
  --phase-past: #8A4B32;
  --phase-past-bg: #F2DFD5;
  --freeze-default: #4D7EA3;
  --font-text: 'Familjen Grotesk', system-ui, -apple-system, 'Segoe UI', sans-serif;
  --font-code: 'JetBrains Mono', ui-monospace, 'Cascadia Mono', Consolas, monospace;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg-ground: #1B1613;
    --bg-surface: #262019;
    --bg-sunk: #141110;
    --line-default: #3A322C;
    --line-strong: #54493F;
    --ink-default: #EDE6DC;
    --ink-muted: #A99F94;
    --ink-faint: #6E655D;
    --ink-inverse: #1B1613;
    --accent-cherry: #E0505A;
    --phase-resting: #8E98A8;
    --phase-resting-bg: #2B3038;
    --phase-rested: #D9A53A;
    --phase-peak: #6FA374;
    --phase-peak-bg: #1F3322;
    --phase-past: #C07A5C;
    --phase-past-bg: #3A241B;
    --freeze-default: #6FA0C6;
  }
}
* { box-sizing: border-box; }
html, body { margin: 0; }
body {
  background: var(--bg-ground);
  color: var(--ink-default);
  font: 15px/22px var(--font-text);
}
a { color: inherit; }
h1 { font-size: 28px; line-height: 34px; letter-spacing: -1px; font-weight: 600; margin: 0; }
h2 { font-size: 17px; line-height: 24px; letter-spacing: -0.5px; font-weight: 600; margin: 0 0 8px; }
p { margin: 0 0 12px; }
.muted { color: var(--ink-muted); }
.small { font-size: 13px; line-height: 18px; }
.error { color: var(--accent-cherry); }

.shell { display: grid; grid-template-columns: 240px 1fr; min-height: 100vh; }
.side {
  background: var(--bg-sunk);
  padding: 28px 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.brand { display: flex; align-items: center; gap: 8px; font-weight: 600; text-decoration: none; padding: 0 10px 28px; }
.brand svg { color: var(--accent-cherry); }
.nav { display: flex; align-items: center; gap: 12px; padding: 9px 12px; border-radius: 8px; text-decoration: none; color: var(--ink-muted); }
.nav[aria-current='page'] { background: var(--bg-surface); color: var(--ink-default); font-weight: 500; }
.nav svg { flex: none; }
.side .bottom { margin-top: auto; }
main { padding: 40px 48px; max-width: 1200px; }
.page-head { display: flex; align-items: baseline; gap: 12px; margin-bottom: 28px; }
footer { border-top: 1px solid var(--line-default); margin-top: 32px; padding-top: 20px; display: flex; gap: 16px; }
footer a { font-weight: 500; text-decoration: none; }

.grid { display: grid; grid-template-columns: 640px 440px; gap: 24px; align-items: start; }
.stack { display: grid; gap: 24px; }
.card { background: var(--bg-surface); border-radius: 12px; padding: 24px; }
.card.quiet { background: var(--bg-sunk); }
.rows { border-collapse: collapse; width: 100%; }
.rows th, .rows td { text-align: left; padding: 12px 0; border-top: 1px solid var(--line-default); vertical-align: top; }
.rows th { color: var(--ink-muted); font-weight: 400; width: 150px; }
.actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin: 16px 0; }

.button {
  display: inline-flex; align-items: center; justify-content: center;
  font: 500 15px/22px var(--font-text);
  padding: 9px 18px; border-radius: 8px; cursor: pointer; text-decoration: none;
  background: var(--ink-default); color: var(--ink-inverse); border: 1px solid var(--ink-default);
}
.button.secondary { background: transparent; color: var(--ink-default); border-color: var(--line-strong); }
.button.quiet { background: transparent; color: var(--ink-muted); border-color: transparent; }
.button.danger { background: var(--accent-cherry); border-color: var(--accent-cherry); color: #FFF; }
form.inline { display: inline; }

label.field { display: grid; gap: 6px; margin-bottom: 16px; font-size: 13px; color: var(--ink-muted); font-weight: 500; }
input[type='text'], input:not([type]) {
  font: 15px/22px var(--font-text); color: var(--ink-default);
  background: var(--bg-surface); border: 1px solid var(--line-strong); border-radius: 8px;
  padding: 9px 12px; width: 240px;
}
input.wide { width: 100%; }
.check { display: flex; gap: 10px; align-items: center; margin: 16px 0; }

.center { min-height: 100vh; display: grid; place-items: center; padding: 24px; }
.center .card { width: 480px; }
.center .card.wide { width: 560px; }
.center .brand-line { color: var(--ink-muted); font-size: 13px; margin-bottom: 16px; }
.center h1 { margin-bottom: 20px; }
.secret {
  font: 28px/40px var(--font-code); letter-spacing: 2px; text-align: center;
  background: var(--bg-sunk); border-radius: 8px; padding: 10px; margin: 16px 0;
}
.note { border: 1px solid var(--phase-rested); border-radius: 8px; padding: 12px 16px; margin: 16px 0; }

@media print {
  .side, footer, .actions, .no-print { display: none; }
}
`;

/**
 * The app's own script, served at /assets/app.js: the few things a form can't do. Buttons that need it start hidden,
 * so a browser without scripts never shows a button that does nothing.
 */
export const appScript = `
for (const button of document.querySelectorAll('[data-copy]')) {
  button.hidden = false;
  button.addEventListener('click', () => {
    navigator.clipboard.writeText(button.dataset.copy).then(() => { button.textContent = 'Copied'; });
  });
}
for (const button of document.querySelectorAll('[data-print]')) {
  button.hidden = false;
  button.addEventListener('click', () => window.print());
}
`;
