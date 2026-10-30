'use strict';
// Appearance: the colour tokens and layout settings of this browser (§4). Built-ins are read-only; changing one forks
// it into "<Name> (custom)", as templates do. Applied as CSS variables on <html>, so the page, the modules and the
// canvases (through Pit.tokens()) all follow. Settings › Appearance hosts the editor (Appearance.render).

const AP_TOKENS = [   // [json key, css var, role, group]
  ['bg', '--bg', 'Page background', 'Surface'], ['panel', '--panel', 'Module body fill (boxed and flat panels)', 'Surface'],
  ['raise', '--raise', 'Hover, row cursor, inputs', 'Surface'], ['line', '--line', 'Borders, rules, grid', 'Surface'],
  ['line2', '--line2', 'Table row dividers, meter tracks', 'Surface'], ['text', '--txt', 'Primary text and values', 'Surface'],
  ['muted', '--mut', 'Secondary text, titles', 'Surface'], ['dim', '--dim', 'Labels, axes, disabled', 'Surface'],
  ['accent', '--acc', 'Focus car, selection, keyboard focus, links', 'Identity'], ['me', '--me', 'Your car: row bar, map disc, YOU tag', 'Identity'],
  ['best', '--best', 'Session best (always with ◆)', 'Timing'], ['pb', '--pb', 'Personal best, improved (always with ●)', 'Timing'],
  ['slow', '--slow', 'Slower than the previous sector', 'Timing'], ['invalid', '--inv', 'Invalid lap (struck through, INV)', 'Timing'],
  ['ok', '--ok', 'In the window, gain, on track', 'State'], ['warn', '--warn', 'Out of the window, near a limit, out-lap', 'State'],
  ['bad', '--bad', 'Critical, loss, stopped', 'State'], ['cold', '--cold', 'Below the window, pit lane, wet compound', 'State'],
  ['chSpeed', '--c-speed', 'Speed trace', 'Traces'], ['chThr', '--c-thr', 'Throttle trace', 'Traces'], ['chBrk', '--c-brk', 'Brake trace', 'Traces'],
  ['chSteer', '--c-steer', 'Steering trace', 'Traces'], ['chGear', '--c-gear', 'Gear trace', 'Traces'], ['chRpm', '--c-rpm', 'RPM trace', 'Traces'],
  ['chRef', '--c-ref', 'Reference lap in overlays (solid)', 'Traces'], ['chCmp', '--c-cmp', 'Comparison lap in overlays (dashed)', 'Traces'],
  ['chLap', '--c-lap', 'Current lap line on the map', 'Traces'], ['chFL', '--c-fl', 'Front left traces', 'Traces'], ['chFR', '--c-fr', 'Front right traces', 'Traces'],
  ['chRL', '--c-rl', 'Rear left traces', 'Traces'], ['chRR', '--c-rr', 'Rear right traces', 'Traces'],
];
// 'invalid' is left out: an invalid time is always struck through and tagged INV, so it may be dimmer than text
const AP_CONTRAST = new Set(['text', 'muted', 'dim', 'ok', 'warn', 'bad', 'cold', 'best', 'pb', 'slow', 'me', 'accent']);
const AP_BASE_TOKENS = {bg:'#0a0b0d', panel:'#101216', raise:'#171a1f', line:'#262a31', line2:'#1b1e24', text:'#e6e8eb', muted:'#a1a7b0', dim:'#7a818b',
  accent:'#2ad4c4', me:'#f2f2f2', best:'#c27aff', pb:'#3ddc84', slow:'#f5c518', invalid:'#6b717a', ok:'#3ddc84', warn:'#ff9f1a', bad:'#ff5468', cold:'#5aaeff',
  chSpeed:'#e6e8eb', chThr:'#3ecf7a', chBrk:'#ff5e57', chSteer:'#f2c230', chGear:'#a98bff', chRpm:'#8a929c', chRef:'#e6e8eb', chCmp:'#ff9f1a', chLap:'#5aaeff',
  chFL:'#35b9d6', chFR:'#3ecf7a', chRL:'#f2c230', chRR:'#f06ab8'};
const AP_LAYOUT = {density:['compact', 'comfortable'], fontScale:[0.9, 1, 1.1, 1.25], radius:[0, 2, 4, 8], panel:['ruled', 'boxed', 'flat'], numFont:['mono', 'sans'], labels:['upper', 'sentence']};
const AP_DEF_LAYOUT = {density:'compact', fontScale:1, radius:2, panel:'ruled', numFont:'mono', labels:'upper'};
const AP_BUILTINS = [
  ['pitwall', 'Pit Wall', {}, {}],
  ['broadcast', 'Broadcast', {bg:'#050608', panel:'#0e1014', line:'#23272e', accent:'#ffffff', me:'#ff8ad8'}, {radius:4, panel:'boxed', labels:'sentence'}],
  ['night', 'Night stint', {bg:'#000000', panel:'#07080a', raise:'#101215', line:'#1a1d22', line2:'#121418', text:'#c9ccd1', muted:'#8a9099', dim:'#646a73', accent:'#5fb3a6',
    me:'#c9ccd1', ok:'#36b56e', warn:'#d9892a', bad:'#d9475a', best:'#a46ad8'}, {}],
  ['daylight', 'Daylight', {bg:'#f3f4f6', panel:'#ffffff', raise:'#e9ebee', line:'#d3d7dd', line2:'#e6e8ec', text:'#111418', muted:'#4a515b', dim:'#6b727c', accent:'#007b76',
    me:'#111418', best:'#7b2fbe', pb:'#0d7e3d', slow:'#8c6900', ok:'#0d7e3d', warn:'#ab5800', bad:'#c8102e', cold:'#1565c0', chSpeed:'#111418', chRef:'#111418',
    chCmp:'#b55d00', chLap:'#1565c0', chThr:'#0f8a43', chBrk:'#c8102e', chSteer:'#9a7400', chRpm:'#6b727c'}, {}],
].map(([id, name, tokens, layout]) => Object.freeze(Object.assign({format:'pitwall-theme', schemaVersion:1, id, name, base:id, tokens:Object.assign({}, AP_BASE_TOKENS, tokens)}, AP_DEF_LAYOUT, layout)));
const HEX = /^#[0-9a-f]{6}$/i;
// state colours mean state: your car and the map line never wear one (dev check)
for (const b of AP_BUILTINS) for (const k of ['me', 'chLap']) console.assert(!['ok', 'warn', 'bad', 'slow'].some(s => b.tokens[s] === b.tokens[k]), `Appearance '${b.id}': ${k} is a state colour`);

// WCAG relative luminance and contrast ratio
const lum = hex => { const v = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

const Appearance = {
  cur: null, users: [], status: '',
  builtin(id){ return AP_BUILTINS.find(b => b.id === id) || null; },
  all(){ return [...AP_BUILTINS, ...this.users]; },
  get(id){ return this.all().find(t => t.id === id) || null; },
  isBuiltin(id){ return !!this.builtin(id); },
  sanitize(raw){
    if (!isObj(raw)) return null;
    const base = this.builtin(raw.base) ? raw.base : 'pitwall', t = {format:'pitwall-theme', schemaVersion:1, id:'th-' + Tpl.newId('').slice(0, 6), name:cleanText(raw.name, 40) || 'Imported theme', base, tokens:{}};
    if (isObj(raw.tokens)) for (const [k, v] of Object.entries(raw.tokens)) if (!BAD_KEYS.has(k) && k in AP_BASE_TOKENS && typeof v === 'string' && HEX.test(v)) t.tokens[k] = v.toLowerCase();
    for (const [k, vals] of Object.entries(AP_LAYOUT)) t[k] = vals.includes(raw[k]) ? raw[k] : this.builtin(base)[k];
    return t;
  },
  resolved(t){ return Object.assign({}, this.builtin(t.base) ? this.builtin(t.base).tokens : AP_BASE_TOKENS, t.tokens); },
  boot(){
    const st = lsGet('pitwall.themes', null);
    this.users = (st && Array.isArray(st.items) ? st.items : []).map(x => { const s = this.sanitize(x); if (s && typeof x.id === 'string' && /^th-[a-z0-9]{6}$/.test(x.id)) s.id = x.id; return s; })
      .filter((x, i, a) => x && a.findIndex(y => y.id === x.id) === i);
    const a = lsGet('pitwall.appearance', null);
    this.cur = a && this.builtin(a.id) ? this.builtin(a.id) : a && this.users.find(u => u.id === a.id) || (a && this.sanitize(a)) || this.builtin('pitwall');
    this.apply(this.cur);
  },
  apply(t){
    const root = document.documentElement, s = root.style, tok = this.resolved(t);
    for (const [k, v] of AP_TOKENS) s.setProperty(v, tok[k]);
    const [r, g, b] = [1, 3, 5].map(i => parseInt(tok.accent.slice(i, i + 2), 16));
    s.setProperty('--acc-ink', 0.2126 * r + 0.7152 * g + 0.0722 * b > 140 ? '#08090b' : '#ffffff');   // text on the accent
    const comf = t.density === 'comfortable';
    s.setProperty('--row', comf ? '32px' : '28px'); s.setProperty('--trow', comf ? '28px' : '24px'); s.setProperty('--pad', comf ? '12px' : '8px'); s.setProperty('--hh', comf ? '32px' : '28px');
    s.setProperty('--fs', t.fontScale); s.setProperty('--r', t.radius + 'px');
    s.setProperty('--num', t.numFont === 'sans' ? '"Barlow Semi Condensed", system-ui, sans-serif' : '"JetBrains Mono", ui-monospace, Consolas, monospace');
    root.dataset.panel = t.panel; root.dataset.labels = t.labels; root.dataset.num = t.numFont;
    // an imported theme the editor would refuse: Settings keeps the default colours, so it can always be undone from there
    const set = $('settings'), safe = this.unreadable(t);
    if (set) for (const [k, v] of AP_TOKENS) safe ? set.style.setProperty(v, AP_BASE_TOKENS[k]) : set.style.removeProperty(v);
    s.colorScheme = lum(tok.bg) > 0.4 ? 'light' : 'dark';
    const m = document.querySelector('meta[name="theme-color"]'); if (m) m.content = tok.bg;
    Pit.emit('theme', t.id); Pit.dirty('theme');
  },
  use(id){
    const t = this.get(id); if (!t) return;
    this.cur = t; lsSet('pitwall.appearance', t); this.apply(t);
  },
  adopt(raw){   // an imported theme, made this browser's; one that looks exactly like a theme already here is that theme
    const t = this.sanitize(raw); if (!t) return null;
    const look = x => JSON.stringify([this.resolved(x), Object.keys(AP_LAYOUT).map(k => x[k])]), same = this.all().find(x => look(x) === look(t));
    if (same) { if (!this.unreadable(same)) this.use(same.id); return same; }
    t.name = this.uniqueName(t.name); this.users.push(t); this.saveUsers();
    if (!this.unreadable(t)) this.use(t.id);   // kept in the list, not applied: the dashboard would become unreadable
    return t;
  },
  // Text, muted and dim must stay readable on the background and the panels, or the editor (drawn with these same tokens)
  // could be made unreadable and the user locked out of undoing it. Returns why not, or ''.
  notApplied(t){ const why = this.unreadable(t); return why ? why.replace(/,? so it was not applied\.?/, '.') : ''; },   // adopt()'s refusal, for a status line
  unreadable(t){
    const k = this.resolved(t);
    for (const x of ['text', 'muted', 'dim']) for (const s of ['bg', 'panel']) { const r = contrast(k[x], k[s]); if (r < 3) return `${AP_LABEL(x)} on ${AP_LABEL(s).toLowerCase()} would be ${r.toFixed(1)}:1. Below 3:1 this screen becomes unreadable, so it was not applied.`; }
    return '';
  },
  saveUsers(){ lsSet('pitwall.themes', {items:this.users}); },
  uniqueName(name){ const taken = new Set(this.all().map(t => t.name)); let n = name.slice(0, 40), k = 2; while (taken.has(n)) n = `${name.slice(0, 34)} (${k++})`; return n; },
  copy(t, name){
    const c = Object.assign(deep(t), {id:'th-' + Tpl.newId('').slice(0, 6), name:this.uniqueName(name), base:t.base});
    c.tokens = this.isBuiltin(t.id) ? {} : Object.assign({}, t.tokens);
    this.users.push(c); this.saveUsers(); return c;
  },
  // Any change to a built-in forks it first; returns the theme to change.
  editable(){
    if (!this.isBuiltin(this.cur.id)) return this.cur;
    const c = this.copy(this.cur, `${this.cur.name} (custom)`);
    // no repaint here: rebuilding the editor mid-drag would detach the colour picker's input and lose the rest of the drag;
    // the list and title follow on the input's change event (or the caller's own paint)
    this.use(c.id); this.status = 'Built-ins are read-only: editing your copy'; this._repaint = true;
    return c;
  },
  change(fn){
    const probe = deep(this.cur); fn(probe);
    const why = this.unreadable(probe);
    if (why) { this.status = why; const s = this.host && this.host.querySelector('.ap-status'); if (s) s.textContent = why; this.refreshReadouts(); return; }
    const t = this.editable(); fn(t);
    lsSet('pitwall.appearance', t); this.saveUsers();
    cancelAnimationFrame(this._raf); this._raf = requestAnimationFrame(() => this.apply(t));
    this.refreshReadouts();
  },

  // ---------- the editor (Settings › Appearance) ----------
  host: null,
  render(host){ this.host = host; this.status = ''; this.renaming = null; this.paint(); },
  paint(){
    const h = this.host; if (!h || !h.isConnected) return;
    this._repaint = false;
    const cur = this.cur, tok = this.resolved(cur), bi = this.isBuiltin(cur.id);
    const fa = document.activeElement, was = h.contains(fa) && fa.dataset.ap ? [fa.dataset.ap, fa.dataset.id] : null;   // redrawn below: focus is given back
    const row = t => {
      const ren = this.renaming === t.id, lock = this.isBuiltin(t.id) ? '<i data-lucide="lock"></i>' : '<span class="ico-gap"></span>', inUse = t.id === cur.id ? '<b class="tag">IN USE</b>' : '';
      const head = ren ? `<span class="ap-use">${lock}<input type="text" class="ap-ren" maxlength="40" value="${esc(t.name)}" aria-label="New name" data-id="${esc(t.id)}">${inUse}</span>`
        : `<button type="button" class="ap-use" data-ap="use" data-id="${esc(t.id)}">${lock}<span class="ap-name">${esc(t.name)}</span>${inUse}</button>`;
      return `<li class="ap-row${t.id === cur.id ? ' on' : ''}">${head}
      <span class="ap-acts"><button type="button" class="linkbtn" data-ap="dup" data-id="${esc(t.id)}">Duplicate</button>${this.isBuiltin(t.id) ? '' : `<button type="button" class="linkbtn" data-ap="ren" data-id="${esc(t.id)}">Rename</button><button type="button" class="linkbtn" data-ap="del" data-id="${esc(t.id)}">Delete</button>`}<button type="button" class="linkbtn" data-ap="exp" data-id="${esc(t.id)}">Export</button></span></li>`;
    };
    const groups = ['Surface', 'Identity', 'Timing', 'State', 'Traces'].map(g => `<fieldset class="ap-grp"><legend>${g}</legend>${AP_TOKENS.filter(x => x[3] === g).map(([k, , role]) => `
      <div class="ap-tok" data-k="${k}"><label for="apc-${k}">${esc(AP_LABEL(k))}</label><span class="note">${esc(role)}</span>
        <input type="color" id="apc-${k}" value="${tok[k]}" aria-label="${esc(AP_LABEL(k))} colour"><input type="text" class="ap-hex n" value="${tok[k]}" maxlength="7" spellcheck="false" aria-label="${esc(AP_LABEL(k))} hex">
        <span class="ap-cr n"></span></div>`).join('')}</fieldset>`).join('');
    const seg = (k, labels) => `<div class="ap-lay"><span class="lbl">${labels[0]}</span><div class="seg" role="group" aria-label="${labels[0]}">${AP_LAYOUT[k].map((v, i) => `<button type="button" data-lay="${k}" data-v="${v}" aria-pressed="${cur[k] === v}">${esc(labels[1][i])}</button>`).join('')}</div></div>`;
    h.innerHTML = `<div class="ap">
      <div class="ap-list"><div class="ap-h"><h3 class="mt">Appearances</h3><label class="btn">Import…<input type="file" accept=".json,application/json" hidden data-ap="imp"></label></div>
        <ul>${AP_BUILTINS.map(row).join('')}${this.users.map(row).join('')}</ul></div>
      <div class="ap-edit"><div class="ap-h"><h3 class="mt">${esc(cur.name)}${bi ? ' <span class="note">built-in: changes make your own copy</span>' : ''}</h3><button type="button" class="btn" data-ap="reset"${bi ? ' disabled title="Built-ins are already their base"' : ''}>Reset to base</button></div>
        <p class="note ap-status" role="status">${esc(this.status)}</p>
        <fieldset class="ap-grp"><legend>Layout</legend>
          ${seg('density', ['Density', ['Compact', 'Comfortable']])}${seg('radius', ['Corner radius', ['0', '2', '4', '8']])}${seg('panel', ['Panels', ['Ruled', 'Boxed', 'Flat']])}
          ${seg('numFont', ['Numbers', ['Mono', 'Sans']])}${seg('labels', ['Labels', ['UPPER', 'Sentence']])}
          <div class="ap-lay"><label class="lbl" for="apFs">Font scale</label><select id="apFs">${AP_LAYOUT.fontScale.map(v => `<option value="${v}"${cur.fontScale === v ? ' selected' : ''}>${Math.round(v * 100)} %</option>`).join('')}</select></div>
        </fieldset>${groups}</div></div>`;
    this.refreshReadouts(); refreshIcons(h);
    const ren = h.querySelector('.ap-ren'); if (ren) { ren.focus(); ren.select(); }
    else if (was) (was[1] && [...h.querySelectorAll(`[data-ap="${was[0]}"]`)].find(b => b.dataset.id === was[1] && !b.disabled) || h.querySelector('.ap-row.on .ap-use')).focus({preventScroll:true});
  },
  rename(id, name){   // inline, as in the template manager: Enter or leaving the field keeps it, Esc cancels
    const t = this.users.find(u => u.id === id); this.renaming = null;
    const n = cleanText(name || '', 40);
    if (t && n && n !== t.name) { t.name = this.uniqueName(n); this.saveUsers(); if (this.cur.id === t.id) lsSet('pitwall.appearance', t); this.status = `Renamed to '${t.name}'.`; }
    this.paint();
  },
  refreshReadouts(){
    const h = this.host; if (!h || !h.isConnected) return;
    const tok = this.resolved(this.cur);
    for (const el of h.querySelectorAll('.ap-tok')) {
      const k = el.dataset.k, cr = el.querySelector('.ap-cr'), c = el.querySelector('[type=color]'), x = el.querySelector('.ap-hex');
      if (c.value !== tok[k]) c.value = tok[k];
      if (document.activeElement !== x && x.value !== tok[k]) x.value = tok[k];
      if (!AP_CONTRAST.has(k)) { cr.innerHTML = ''; continue; }
      const r = +contrast(tok[k], tok.bg).toFixed(1), min = k === 'dim' ? 3 : 4.5;   // judged on the figure shown
      cr.innerHTML = r >= 7 ? `${r.toFixed(1)}:1 AAA` : r >= min ? `${r.toFixed(1)}:1 AA` : `<i data-lucide="triangle-alert"></i>${r.toFixed(1)}:1 low`;
      cr.className = 'ap-cr n' + (r < min ? ' s-warn' : '');
    }
    refreshIcons(h);
  },
};
const AP_LABEL = k => ({bg:'Background', line2:'Line 2', chSpeed:'Speed', chThr:'Throttle', chBrk:'Brake', chSteer:'Steering', chGear:'Gear', chRpm:'RPM', chRef:'Reference',
  chCmp:'Comparison', chLap:'Current lap', chFL:'FL', chFR:'FR', chRL:'RL', chRR:'RR', pb:'Personal best', me:'Your car'}[k] || k[0].toUpperCase() + k.slice(1));

// Editor events, delegated on the settings overlay (the host lives inside it).
document.addEventListener('input', e => {
  const t = e.target, tok = t.closest && t.closest('#settings .ap-tok');
  if (tok && t.type === 'color') Appearance.change(th => { th.tokens[tok.dataset.k] = t.value.toLowerCase(); });
});
document.addEventListener('change', e => {
  const t = e.target; if (!t.closest || !t.closest('#settings .ap')) return;
  if (t.classList.contains('ap-hex')) {
    const k = t.closest('.ap-tok').dataset.k, v = t.value.trim();
    if (HEX.test(v)) Appearance.change(th => { th.tokens[k] = v.toLowerCase(); });
    else { t.value = Appearance.resolved(Appearance.cur)[k]; Appearance.status = 'Colours are six-digit hex, like #2ad4c4.'; $('settings').querySelector('.ap-status').textContent = Appearance.status; }
  }
  if (t.id === 'apFs') Appearance.change(th => { th.fontScale = +t.value; });
  if (Appearance._repaint) Appearance.paint();   // a built-in forked by this change: the list and the title now show the copy
  if (t.dataset.ap === 'imp' && t.files[0]) apImport(t.files[0]).then(() => { t.value = ''; });
});
document.addEventListener('click', async e => {
  const b = e.target.closest && e.target.closest('#settings .ap [data-ap], #settings .ap [data-lay]'); if (!b) return;
  const A = Appearance;
  if (b.dataset.lay) { const k = b.dataset.lay, v = k === 'radius' ? +b.dataset.v : b.dataset.v; A.change(th => { th[k] = v; }); A.paint(); return; }
  const t = A.get(b.dataset.id);
  switch (b.dataset.ap) {
    case 'imp': return;   // the file input inside the Import label: handled on change
    case 'use': A.use(t.id); A.status = ''; A.renaming = null; break;
    case 'dup': { const c = A.copy(t, `${t.name} (copy)`); A.use(c.id); A.status = `Made '${c.name}'.`; break; }
    case 'ren': A.renaming = t.id; A.status = ''; break;
    case 'del': {
      if (await ask(`Delete the appearance '${t.name}'?`, [['del', 'Delete', true], ['', 'Cancel']]) !== 'del') return;
      A.users = A.users.filter(u => u.id !== t.id); A.saveUsers(); if (A.cur.id === t.id) A.use('pitwall'); A.status = `Deleted '${t.name}'.`; break;
    }
    case 'exp': { const o = {format:'pitwall-theme', schemaVersion:1, id:t.id, name:t.name, base:t.base, tokens:A.isBuiltin(t.id) ? {} : t.tokens}; for (const k of Object.keys(AP_LAYOUT)) o[k] = t[k]; download(`${slug(t.name)}.pitwall-theme.json`, o); return; }
    case 'reset': {
      const base = A.builtin(A.cur.base) || A.builtin('pitwall');
      if (A.isBuiltin(A.cur.id)) return;
      A.change(th => { th.tokens = {}; for (const k of Object.keys(AP_LAYOUT)) th[k] = base[k]; }); A.status = `Back to ${base.name}.`; break;
    }
  }
  A.paint();
});
document.addEventListener('keydown', e => {
  if (!e.target.classList || !e.target.classList.contains('ap-ren')) return;
  if (e.key === 'Enter') { e.preventDefault(); Appearance.rename(e.target.dataset.id, e.target.value); }
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); Appearance.renaming = null; Appearance.paint(); }
}, true);
document.addEventListener('focusout', e => { if (e.target.classList && e.target.classList.contains('ap-ren') && Appearance.renaming) Appearance.rename(e.target.dataset.id, e.target.value); });
async function apImport(file){
  const A = Appearance;
  if (file.size > 65536) { A.status = 'File too large.'; return A.paint(); }
  let j; try { j = JSON.parse(await file.text()); } catch (e) { A.status = 'Not a valid JSON file.'; return A.paint(); }
  if (!isObj(j) || j.format !== 'pitwall-theme') { A.status = 'Not a Pit Wall theme file.'; return A.paint(); }
  if (!Number.isInteger(j.schemaVersion) || j.schemaVersion > 1) { A.status = 'This theme was made by a newer Pit Wall.'; return A.paint(); }
  const t = A.adopt(j), why = A.notApplied(t); A.status = why ? `Imported '${t.name}' but not applied: ${why}` : `Imported '${t.name}'.`; A.paint();
}
