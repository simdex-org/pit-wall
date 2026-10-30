'use strict';
// Template manager (§3.4, key T): use, duplicate, rename, delete, export and import templates; and the one-off
// migration of the old single-page settings (§3.9). Imported files are untrusted: everything goes through
// Tpl.sanitize / Appearance.sanitize, and every string reaches the DOM through esc().

const OLD_TH_DEF = {psiMin:26.0, psiMax:27.0, tMin:65, tMax:105, brakeMax:750, padMin:12, fuelLaps:3};
const Manager = {
  status: '', renaming: null, incAp: false,
  open(){
    const d = $('dlgTemplates'); this.status = ''; this.renaming = null; this.draw();
    if (!d.open) d.showModal();
  },
  draw(){
    const d = $('dlgTemplates'), cur = Tpl.cur, inc = this.incAp;
    const date = s => { const t = Date.parse(s); return isNaN(t) ? '' : new Date(t).toLocaleDateString([], {year:'numeric', month:'short', day:'numeric'}); };
    const row = t => { const bi = Tpl.isBuiltin(t.id), id = esc(t.id);
      return `<tr data-id="${id}"${t.id === cur.id ? ' class="focus" aria-selected="true"' : ''}>
        <td class="tm-name">${this.renaming === t.id ? `<input type="text" class="tm-ren" maxlength="40" value="${esc(t.name)}" aria-label="New name">` : `<b>${esc(t.name)}</b>`}
          ${bi ? '<span class="note"><i data-lucide="lock"></i> built-in</span>' : ''}${t.id === cur.id ? ' <b class="tag">ACTIVE</b>' : ''}</td>
        <td class="n">${t.workspaces.length}</td><td class="n">${t.workspaces.reduce((a, w) => a + w.modules.length, 0)}</td><td>${bi ? '' : esc(date(t.updated))}</td>
        <td class="tm-acts"><button type="button" class="btn" data-tm="use"${t.id === cur.id ? ' disabled' : ''}>Use</button><button type="button" class="btn" data-tm="dup">Duplicate</button>${bi ? '' : '<button type="button" class="btn" data-tm="ren">Rename</button><button type="button" class="btn" data-tm="del">Delete</button>'}<button type="button" class="btn" data-tm="exp">Export</button></td></tr>`; };
    d.innerHTML = `<form method="dialog" class="dlg-body wide"><header class="dlg-h"><h2>Templates</h2><button class="btn icon" value="" aria-label="Close"><i data-lucide="x"></i></button></header>
      <p class="note">A template is a set of workspaces (the tabs). Built-in templates are read-only: editing one makes your own copy. Templates move between PCs by export and import.</p>
      <div class="dlg-scroll"><table class="tt"><thead><tr><th>Name</th><th class="n">Workspaces</th><th class="n">Modules</th><th>Updated</th><th></th></tr></thead>
        <tbody>${Tpl.builtins.map(row).join('')}${Tpl.items.map(row).join('')}</tbody></table></div>
      <p class="note tm-status" role="status">${esc(this.status)}</p>
      <div class="dlg-foot"><label class="btn">Import…<input type="file" accept=".json,application/json" hidden id="tmImport"></label><button type="button" class="btn" data-tm="blank">New from blank</button>
        <label class="check"><input type="checkbox" id="tmIncAp"${inc ? ' checked' : ''}>Include my appearance when exporting</label><span class="top-gap"></span><button class="btn primary" value="">Done</button></div></form>`;
    refreshIcons(d);
    const r = d.querySelector('.tm-ren'); if (r) { r.focus(); r.select(); }
  },
  say(t){ this.status = t; const s = $('dlgTemplates').querySelector('.tm-status'); if (s) s.textContent = t; },
  async act(a, id){
    const t = Tpl.get(id);
    if (a === 'blank') {
      const n = Tpl.save({format:'pitwall-template', schemaVersion:1, id:Tpl.newId('t-'), name:Tpl.uniqueName('New template'), created:new Date().toISOString(), updated:'', workspaces:[{id:'w-workspace', name:'Workspace', modules:[]}]});
      if (!(await Editor.leave())) return;
      Tpl.use(n.id); this.renaming = n.id; this.say(`Made '${n.name}'. Press E to add modules.`); return this.draw();
    }
    if (!t) return;
    if (a === 'use') { if (!(await Editor.leave())) return; Tpl.use(t.id); this.say(`Using '${t.name}'.`); }
    else if (a === 'dup') { const c = Tpl.fork(t, `${t.name} (copy)`); this.say(`Made '${c.name}'.`); }
    else if (a === 'ren') { this.renaming = t.id; }
    else if (a === 'del') {
      if (await ask(`Delete the template '${t.name}'? This cannot be undone.`, [['del', 'Delete', true], ['', 'Cancel']]) !== 'del') return;
      const was = Tpl.cur.id === t.id;
      if (was && Editor.active) { Editor.active = false; Editor.exit(); }
      Tpl.remove(t.id); if (was) Tpl.use('builtin-race');
      this.say(`Deleted '${t.name}'.`);
    }
    else if (a === 'exp') return this.export(t);
    this.draw();
  },
  rename(id, name){
    const t = Tpl.get(id); this.renaming = null;
    name = cleanText(name, 40);
    if (t && !Tpl.isBuiltin(id) && name && name !== t.name) { t.name = Tpl.uniqueName(name, id); Tpl.save(t); if (Tpl.cur.id === id) renderTabs(true); this.say(`Renamed to '${t.name}'.`); }
    this.draw();
  },
  export(t){
    const o = {format:'pitwall-template', schemaVersion:Tpl.SCHEMA, id:t.id, name:t.name};
    if (t.basedOn) o.basedOn = t.basedOn;
    o.created = t.created; o.updated = t.updated; o.workspaces = deep(t.workspaces);
    if (this.incAp) { const a = Appearance.cur, ap = {format:'pitwall-theme', schemaVersion:1, name:a.name, base:a.base, tokens:Appearance.isBuiltin(a.id) ? {} : a.tokens}; for (const k of Object.keys(AP_LAYOUT)) ap[k] = a[k]; o.appearance = ap; }
    const text = JSON.stringify(o, null, 1);
    // the key as a whole JSON string (a template name or text field equal to it), or anywhere when it is long enough not to be a word
    if (Pit.key && (text.includes(JSON.stringify(Pit.key)) || Pit.key.length >= 12 && text.includes(Pit.key))) return this.say('Export blocked: it would contain the access key');
    download(`${slug(t.name)}.pitwall.json`, text); this.say(`Exported '${t.name}'.`);
  },
  async import(file){
    if (file.size > 512 * 1024) return this.say('File too large');
    let raw; try { raw = JSON.parse(await file.text()); } catch (e) { return this.say('Not a valid JSON file.'); }
    if (!isObj(raw) || raw.format !== 'pitwall-template') return this.say('Not a Pit Wall template file.');
    if (!Number.isInteger(raw.schemaVersion) || raw.schemaVersion < 0) return this.say('This template has no valid schema version.');
    if (raw.schemaVersion > Tpl.SCHEMA) return this.say('This template was made by a newer Pit Wall.');
    for (let v = raw.schemaVersion; v < Tpl.SCHEMA; v++) { if (!Tpl.MIGRATE[v]) return this.say(`Cannot read schema version ${raw.schemaVersion}.`); raw = Tpl.MIGRATE[v](raw); }
    let res; try { res = Tpl.sanitize(raw, {keepAppearance:true}); } catch (e) { return this.say('Not a Pit Wall template file.'); }
    const t = res.t, ap = t.appearance; delete t.appearance;
    t.id = Tpl.newId('t-');
    t.name = Tpl.uniqueName(t.name); t.created = t.updated = new Date().toISOString();
    if (ap && await ask('This template carries an appearance. Apply it?', [['apply', 'Apply', true], ['', 'Keep mine']]) === 'apply') Appearance.adopt(ap);
    if (!(await Editor.leave())) return;
    Tpl.save(t); Tpl.use(t.id);
    const nm = t.workspaces.reduce((a, w) => a + w.modules.length, 0), nd = res.dropped.length;
    this.say(`Imported '${t.name}': ${t.workspaces.length} workspace${t.workspaces.length === 1 ? '' : 's'}, ${nm} module${nm === 1 ? '' : 's'}${nd ? `, ${nd} unknown module${nd === 1 ? '' : 's'} dropped` : ''}${res.fixed ? `, ${res.fixed} value${res.fixed === 1 ? '' : 's'} corrected` : ''}`);
    this.draw();
  },

  // ---------- §3.9: the old engineer.settings, once ----------
  migrate(){
    const k = lsRaw('engineer.pitkey'); if (k && !lsRaw('pitwall.pitkey') && !lsRaw('pitwall.migrated')) lsSet('pitwall.pitkey', k);   // the old key, once
    if (lsRaw('pitwall.migrated') || lsRaw('engineer.settings') == null) { if (k) lsSet('pitwall.migrated', '1'); return; }
    const S = lsGet('engineer.settings', null);
    if (isObj(S)) {
      const p = Pit.prefs;
      for (const k of ['speed', 'temp', 'press']) if (UNITS[k][S[k]]) p.units[k] = S[k];
      if (typeof S.sound === 'boolean') p.sound = S.sound;
      Pit.savePrefs();
      if (typeof S.notes === 'string' && S.notes && lsRaw('pitwall.notes') == null) lsSet('pitwall.notes', S.notes);
      if (isObj(S.pit) && lsRaw('pitwall.plan') == null) lsSet('pitwall.plan', S.pit);
      if (Array.isArray(S.board)) this.migrateBoard(S.board, Array.isArray(S.rows) ? S.rows.filter(x => typeof x === 'string') : null);
      this.migrateTheme(S.theme, S.accent);
      const old = {}; let diff = false;
      for (const [k, d] of Object.entries(OLD_TH_DEF)) { const v = S[k]; old[k] = typeof v === 'number' && isFinite(v) ? v : d; if (old[k] !== d) diff = true; }
      if (diff) lsSet('pitwall.oldThresholds', old);
    }
    lsSet('pitwall.migrated', '1');
  },
  migrateBoard(board, rows){
    const MAP = {timeline:'stint-timeline', fuel:'fuel', window:'race-plan', gaps:'battle', weather:'weather', tyres:'tyres', degradation:'degradation', brakes:'brakes', pitstop:'pit-plan', electronics:'electronics', damage:'damage'};
    const race = BUILTIN_TEMPLATES.find(b => b.id === 'builtin-race'), t = deep(race), mods = [];
    const add = (type, w, h, hidden) => {
      const def = Pit.registry.get(type), s = def ? def.size : {minW:1, minH:1, w:4, h:6};
      w = clamp(Math.round(+w) || s.w, s.minW, 12); h = clamp(Math.max(s.minH, Math.round((h * 82 - 10 + 8) / 36)), 1, 60);   // 72 px rows + 10 px gap -> 28 px rows + 8 px gap
      const at = freeSpot(mods, w, h);
      mods.push({id:uniqueModId(t, mods), type, x:at.x, y:at.y, w, h, hidden:!!hidden, options:{}});
    };
    for (const r of board) if (Array.isArray(r) && MAP[r[0]]) add(MAP[r[0]], r[1], +r[2] || 4, r[3] === false);
    if (!mods.some(m => m.type === 'pit-plan')) add('pit-plan', 7, 8, false);
    t.workspaces.find(w => w.id === 'w-strategy').modules = mods;
    if (rows) for (const w of t.workspaces) for (const m of w.modules) if (m.type === 'channels') m.options.rows = rows;
    Object.assign(t, {id:Tpl.newId('t-'), name:'My layout (migrated)', basedOn:'builtin-race', created:new Date().toISOString()});
    const s = Tpl.sanitize(t, {keepUnknown:true}).t;
    const st = lsGet('pitwall.templates', null), items = st && Array.isArray(st.items) ? st.items : [];
    items.push(Object.assign(s, {updated:new Date().toISOString()}));
    lsSet('pitwall.templates', {schemaVersion:Tpl.SCHEMA, items}); lsSet('pitwall.active', s.id);
  },
  migrateTheme(theme, accent){
    if (lsRaw('pitwall.appearance') != null) return;
    const base = Appearance.builtin({broadcast:'broadcast', endurance:'night'}[theme] || 'pitwall');
    if (typeof accent === 'string' && HEX.test(accent)) {
      const t = Object.assign(deep(base), {id:'th-' + Tpl.newId('').slice(0, 6), name:`${base.name} (custom)`, base:base.id, tokens:{accent:accent.toLowerCase()}});
      const st = lsGet('pitwall.themes', null), items = st && Array.isArray(st.items) ? st.items : [];
      items.push(t); lsSet('pitwall.themes', {items}); lsSet('pitwall.appearance', t);
    } else lsSet('pitwall.appearance', base);
  },
  // The banner's two buttons: send the old thresholds to the bridge as GT3's, or forget them. Nothing is sent unasked.
  async resolveOld(send){
    const o = lsGet('pitwall.oldThresholds', null);
    if (send && isObj(o)) {
      if (!Pit.key) { Pit.say('Sending thresholds needs the access key: Settings › Connection', 1); return false; }
      const cold = ctx.th && ctx.th.brake_c ? ctx.th.brake_c : DEF_TH.brake_c;
      const r = await Pit.post('/config', {thresholds:{GT3:{dry_psi:[o.psiMin, o.psiMax], tyre_c:[o.tMin, o.tMax],
        brake_c:{front:[cold.front[0], o.brakeMax], rear:[cold.rear[0], o.brakeMax]}, pad_low_mm:o.padMin}}, fuel_low_laps:o.fuelLaps});
      if (!r.ok) { Pit.say(r.status === 403 ? 'Wrong or missing access key' : `The bridge refused the thresholds: ${r.text.slice(0, 80)}`, 1); return false; }
      Pit.say('Thresholds sent to the bridge for GT3');
    }
    lsDel('pitwall.oldThresholds'); return true;
  },
};

// ---------- dialog events ----------
$('dlgTemplates').addEventListener('click', e => {
  const b = e.target.closest('[data-tm]'); if (!b) return;
  const tr = b.closest('tr'); Manager.act(b.dataset.tm, tr && tr.dataset.id);
});
$('dlgTemplates').addEventListener('change', e => {
  if (e.target.id === 'tmImport' && e.target.files[0]) { const f = e.target.files[0]; e.target.value = ''; Manager.import(f); }
  if (e.target.id === 'tmIncAp') Manager.incAp = e.target.checked;
});
$('dlgTemplates').addEventListener('keydown', e => {
  if (!e.target.classList.contains('tm-ren')) return;
  if (e.key === 'Enter') { e.preventDefault(); Manager.rename(e.target.closest('tr').dataset.id, e.target.value); }
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); Manager.renaming = null; Manager.draw(); }
});
$('dlgTemplates').addEventListener('cancel', e => { if (Manager.renaming) e.preventDefault(); });   // Esc while renaming cancels the rename, not the dialog
$('dlgTemplates').addEventListener('focusout', e => { if (e.target.classList && e.target.classList.contains('tm-ren') && Manager.renaming) Manager.rename(e.target.closest('tr').dataset.id, e.target.value); });
