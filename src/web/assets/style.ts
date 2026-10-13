import { createHash } from 'node:crypto';
import { fontFaces } from './fonts.js';

/** The dark color tokens ("BeanQuery color dark"), used by the system's dark preference and by the Dark theme. */
const darkTokens = `
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
  --freeze-default: #6FA0C6;`;

/**
 * The app's stylesheet, served at /assets/app.css. The color tokens are the Figma variables ("BeanQuery color" and
 * "BeanQuery color dark"), so a screen here and its design use the same names. The fonts are served by the app
 * (fonts.ts); text in other scripts falls back to the system's fonts.
 */
export const styleSheet = `
${fontFaces}

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
/* The dark tokens apply under the system's dark preference unless the account chose Light, and always under Dark. */
:root[data-theme="light"] { color-scheme: light; }
:root[data-theme="dark"] {
  color-scheme: dark;
${darkTokens}
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
${darkTokens}
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
/* The sidebar stays in view while the page scrolls, so Account is always at the window's bottom left. */
.side {
  background: var(--bg-sunk);
  padding: 28px 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  position: sticky;
  top: 0;
  height: 100vh;
  overflow-y: auto;
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

[hidden] { display: none !important; }
[data-live-region] { display: contents; }
.visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.display { font-size: 44px; line-height: 48px; letter-spacing: -1.5px; }
.crumbs { margin-bottom: 20px; }
.crumbs a { text-decoration: none; }
.chips { display: flex; gap: 8px; flex-wrap: wrap; margin: 12px 0 24px; }
.chip { background: var(--bg-sunk); border-radius: 6px; padding: 2px 8px; font-size: 13px; font-weight: 500; }
.chip.assumed { background: transparent; border: 1px dashed var(--line-strong); color: var(--ink-muted); }
.bag-head { display: flex; justify-content: space-between; align-items: flex-end; gap: 24px; }
.state-form { display: flex; gap: 8px; margin-bottom: 24px; }
select, input[name='q'] {
  font: 13px/18px var(--font-text); color: var(--ink-default); background: var(--bg-surface);
  border: 1px solid var(--line-strong); border-radius: 999px; padding: 8px 14px;
}
input[name='q'] { width: 280px; }
.filters { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 24px 0 16px; }
.filters .button { padding: 7px 14px; font-size: 13px; }

.pill { display: inline-flex; align-items: center; gap: 6px; border-radius: 999px; padding: 2px 10px; font-size: 13px; font-weight: 500; white-space: nowrap; }
.pill::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.pill.quiet { background: var(--bg-sunk); color: var(--ink-muted); font-size: 12px; }
.pill.quiet::before { display: none; }
.phase-resting, .phase-no_roast_date, .phase-no_plan { background: var(--phase-resting-bg); color: var(--phase-resting); }
.phase-rested { background: var(--phase-resting-bg); color: var(--phase-rested); }
.phase-peak { background: var(--phase-peak-bg); color: var(--phase-peak); }
.phase-past { background: var(--phase-past-bg); color: var(--phase-past); }

.plan-bar { display: block; max-width: 100%; height: auto; }
.plan-bar.faded { opacity: 0.45; }
.seg-resting { fill: var(--phase-resting-bg); background: var(--phase-resting-bg); }
.seg-rested { fill: var(--phase-rested); background: var(--phase-rested); }
.seg-peak { fill: var(--phase-peak); background: var(--phase-peak); }
.seg-portion { fill: var(--freeze-default); background: var(--freeze-default); }
.seg-mid { fill: var(--ink-default); background: var(--ink-default); }
.seg-today { fill: var(--accent-cherry); background: var(--accent-cherry); }
.legend { display: flex; gap: 20px; flex-wrap: wrap; margin: 16px 0; }
.legend .key { display: inline-block; width: 16px; height: 6px; border-radius: 3px; vertical-align: middle; }
.legend .key.thin { width: 2px; height: 12px; }

.beans { display: inline-flex; gap: 3px; vertical-align: middle; }
.bean ellipse { fill: none; stroke: var(--ink-default); stroke-width: 1.2; }
.bean.full ellipse { fill: var(--ink-default); }
.bean .fill { fill: var(--ink-default); }

.table-card { padding: 0; overflow-x: auto; }

.stats-section { margin-bottom: 24px; }
.stats-section h3 { font-size: 15px; line-height: 22px; font-weight: 600; margin: 16px 0 4px; }
.stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 8px 32px; }
table.stats { width: 100%; border-collapse: collapse; }
table.stats th { text-align: left; font-size: 13px; font-weight: 500; color: var(--ink-muted); padding: 6px 0; }
table.stats td { padding: 6px 0; border-top: 1px solid var(--line-default); }
table.stats .number { text-align: right; padding-left: 16px; white-space: nowrap; font-variant-numeric: tabular-nums; }
/* The map: countries tried are shaded with the cherry accent by their share of the bags, in four steps. */
.chart { position: relative; height: 200px; margin: 4px 0 8px; }
.world-map { display: block; width: 100%; height: auto; margin: 8px 0 12px; }
.world-map path { fill: var(--bg-sunk); stroke: var(--bg-surface); stroke-width: 0.5; fill-rule: evenodd; }
.world-map path.m1 { fill: color-mix(in srgb, var(--accent-cherry) 30%, var(--bg-sunk)); }
.world-map path.m2 { fill: color-mix(in srgb, var(--accent-cherry) 55%, var(--bg-sunk)); }
.world-map path.m3 { fill: color-mix(in srgb, var(--accent-cherry) 78%, var(--bg-sunk)); }
.world-map path.m4 { fill: var(--accent-cherry); }
.world-map path:hover { stroke: var(--ink-default); stroke-width: 1; }
table.library { width: 100%; border-collapse: collapse; }
table.library th { text-align: left; font-size: 13px; font-weight: 500; color: var(--ink-muted); padding: 16px 20px; }
table.library td { padding: 14px 20px; border-top: 1px solid var(--line-default); vertical-align: middle; }
table.library .coffee { font-weight: 500; text-decoration: none; }
table.library tr.finished td { color: var(--ink-muted); }

.coming-up h2 .small { font-weight: 400; margin-left: 8px; }
table.events { width: 100%; border-collapse: collapse; }
table.events td { padding: 10px 0; }
table.events td:first-child { width: 120px; }
table.events .today { color: var(--accent-cherry); }
table.events a { text-decoration: none; }

.toasts { position: fixed; top: 24px; right: 24px; display: grid; gap: 12px; width: 400px; z-index: 10; }
.toast { background: var(--bg-surface); border-radius: 12px; padding: 20px; box-shadow: 0 8px 24px rgb(0 0 0 / 16%); border-left: 4px solid var(--freeze-default); }
.toast.mid_peak { border-left-color: var(--phase-peak); }
.toast .actions { margin: 8px 0 0; }

.plan-columns { display: grid; grid-template-columns: repeat(5, 1fr); margin: 16px 0; border-bottom: 1px solid var(--line-default); }
.plan-columns > div { display: grid; gap: 2px; padding: 12px 16px 16px 0; }
.plan-columns > div + div { border-left: 1px solid var(--line-default); padding-left: 16px; }
.ink-rested { color: var(--phase-rested); }
.ink-portion { color: var(--freeze-default); }
.ink-peak { color: var(--phase-peak); }
.three { display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; margin-top: 24px; align-items: start; }
.figures strong { font-size: 24px; margin-right: 12px; }
.note-text { background: var(--bg-sunk); border-radius: 8px; padding: 12px; }

.add-grid { display: grid; grid-template-columns: 440px 1fr; gap: 24px; align-items: start; }
textarea.code {
  font: 13px/20px var(--font-code); color: var(--ink-default); background: var(--bg-sunk);
  border: 0; border-radius: 8px; padding: 16px; width: 100%; resize: vertical;
}
.ok { color: var(--phase-peak); }
.callout { background: var(--bg-sunk); border-radius: 8px; padding: 14px 16px; margin-bottom: 16px; }
.problem { border: 1px solid var(--accent-cherry); border-radius: 8px; padding: 14px 16px; margin-bottom: 16px; }
.problem code { font-family: var(--font-code); }
fieldset.question { border: 1px solid var(--phase-rested); border-radius: 12px; padding: 16px 20px; margin: 0 0 16px; }
fieldset.question legend { font-weight: 600; padding: 0 6px; }
label.choice { display: flex; gap: 10px; align-items: center; border: 1px solid var(--line-default); border-radius: 8px; padding: 10px 14px; margin: 8px 0; }
.bag-summary h2 { margin-top: 16px; }

.tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--line-default); margin: -8px 0 24px; }
.tab { padding: 8px 14px; text-decoration: none; color: var(--ink-muted); border-bottom: 2px solid transparent; margin-bottom: -1px; }
.tab[aria-current='page'] { color: var(--ink-default); border-bottom-color: var(--ink-default); font-weight: 500; }
.add-grid.wide-first { grid-template-columns: 1fr 320px; }
fieldset.form-group { border: 0; border-top: 1px solid var(--line-default); padding: 16px 0 0; margin: 0 0 8px; min-width: 0; }
fieldset.form-group legend { font-weight: 600; padding: 0 8px 0 0; }
.form-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 0 16px; }
.form-grid label.field input, .form-grid label.field select, .form-grid label.field textarea { width: 100%; }
.form-grid label.field.span { grid-column: 1 / -1; }
.form-grid .check { margin: 30px 0 16px; font-size: 13px; }
label.field select { border-radius: 8px; font-size: 15px; line-height: 22px; padding: 9px 12px; }
input[type='date'], label.field textarea {
  font: 15px/22px var(--font-text); color: var(--ink-default);
  background: var(--bg-surface); border: 1px solid var(--line-strong); border-radius: 8px; padding: 9px 12px;
}
.bag-tools { display: flex; justify-content: space-between; align-items: center; gap: 16px; }
.bag-tools .actions { margin: 0; }
.verdict .form-grid { grid-template-columns: 1fr 1fr; }
form.inline-confirm { display: flex; gap: 8px; align-items: center; }
form.inline-confirm .check { margin: 0; }
.split { display: grid; grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); gap: 24px; align-items: start; }
@media (max-width: 900px) { .split { grid-template-columns: minmax(0, 1fr); } }
.figure { font-size: 32px; line-height: 40px; letter-spacing: -1px; margin-right: 8px; }
textarea.note-input { width: 100%; font: 15px/22px var(--font-text); color: var(--ink-default); background: var(--bg-surface); border: 1px solid var(--line-strong); border-radius: 8px; padding: 9px 12px; }

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
for (const input of document.querySelectorAll('[data-time-zone]')) {
  input.value = Intl.DateTimeFormat().resolvedOptions().timeZone;
}
for (const button of document.querySelectorAll('[data-print]')) {
  button.hidden = false;
  button.addEventListener('click', () => window.print());
}

// A filter or search applies as it changes: a select at once, typing after a pause. The page is fetched with the
// form's query and its live regions swapped in, so the form and the focus stay; the address follows the query.
for (const form of document.querySelectorAll('form[data-live]')) {
  for (const button of form.querySelectorAll('button[type="submit"]')) button.hidden = true;
  let timer;
  let latest = 0;
  const apply = async () => {
    clearTimeout(timer);
    const url = new URL(form.action);
    url.search = new URLSearchParams([...new FormData(form)].filter(([, value]) => value !== '')).toString();
    const request = ++latest;
    try {
      const response = await fetch(url);
      if (request !== latest) return;
      if (!response.ok || response.redirected) return location.assign(response.url);
      const page = new DOMParser().parseFromString(await response.text(), 'text/html');
      if (request !== latest) return;
      for (const region of document.querySelectorAll('[data-live-region]')) {
        const fresh = page.querySelector('[data-live-region="' + region.dataset.liveRegion + '"]');
        if (fresh) region.replaceWith(document.adoptNode(fresh));
      }
      history.replaceState(null, '', url);
    } catch {
      if (request === latest) location.assign(url);
    }
  };
  form.addEventListener('change', (event) => {
    if (event.target instanceof HTMLSelectElement) apply();
  });
  form.addEventListener('input', (event) => {
    if (!(event.target instanceof HTMLInputElement)) return;
    clearTimeout(timer);
    timer = setTimeout(apply, 300);
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    apply();
  });
}

// The stats page's charts, drawn by Chart.js (loaded on that page only) from each canvas's data, in the page's colors.
if (window.Chart) {
  const css = getComputedStyle(document.documentElement);
  const token = (name) => css.getPropertyValue(name).trim();
  Chart.defaults.font.family = token('--font-text');
  Chart.defaults.color = token('--ink-muted');
  Chart.defaults.borderColor = token('--line-default');
  Chart.defaults.animation = false;
  Chart.defaults.maintainAspectRatio = false;
  Chart.defaults.plugins.legend.display = false;
  const bags = (n) => (n === 1 ? '1 bag' : n + ' bags');
  const tallyChart = (data) => ({
    type: 'bar',
    data: { labels: data.labels, datasets: [{ data: data.bags, backgroundColor: token('--accent-cherry'), borderRadius: 4, maxBarThickness: 48 }] },
    options: {
      indexAxis: data.kind === 'rows' ? 'y' : 'x',
      scales: {
        [data.kind === 'rows' ? 'x' : 'y']: { beginAtZero: true, ticks: { precision: 0 } },
        [data.kind === 'rows' ? 'y' : 'x']: { grid: { display: false } },
      },
      plugins: {
        tooltip: {
          callbacks: {
            label: (item) => {
              const rating = data.ratings[item.dataIndex];
              return bags(item.raw) + (rating === null ? ', not rated' : ', rated ' + rating.toFixed(1));
            },
          },
        },
      },
    },
  });
  const spendingChart = (data) => {
    const money = new Intl.NumberFormat('en-GB', { style: 'currency', currency: data.currency });
    return {
      data: {
        labels: data.labels,
        datasets: [
          { type: 'bar', label: 'Spent', data: data.spent, backgroundColor: token('--accent-cherry'), borderRadius: 4, maxBarThickness: 48, yAxisID: 'spent' },
          { type: 'line', label: 'Per 100 g', data: data.per100g, borderColor: token('--ink-default'), backgroundColor: token('--ink-default'), spanGaps: true, yAxisID: 'per100g' },
        ],
      },
      options: {
        scales: {
          spent: { position: 'left', beginAtZero: true, ticks: { callback: (value) => money.format(value) } },
          per100g: { position: 'right', beginAtZero: true, grid: { display: false }, ticks: { callback: (value) => money.format(value) } },
          x: { grid: { display: false } },
        },
        plugins: {
          legend: { display: true, position: 'bottom' },
          tooltip: { callbacks: { label: (item) => item.dataset.label + ': ' + money.format(item.raw) } },
        },
      },
    };
  };
  for (const canvas of document.querySelectorAll('canvas[data-chart]')) {
    const data = JSON.parse(canvas.dataset.chart);
    canvas.parentElement.hidden = false;
    new Chart(canvas, data.kind === 'spending' ? spendingChart(data) : tallyChart(data));
  }
}

// A select that saves one choice, such as a bag's state or the theme, saves as soon as it changes.
for (const form of document.querySelectorAll('form[data-auto-submit]')) {
  for (const button of form.querySelectorAll('button[type="submit"]')) button.hidden = true;
  form.addEventListener('change', () => form.requestSubmit());
}
`;

/** A short hash of the assets, put in their URLs so a deploy's new styles and script are fetched despite caching. */
export const assetVersion = createHash('sha256').update(styleSheet).update(appScript).digest('hex').slice(0, 10);
