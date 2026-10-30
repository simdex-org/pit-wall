'use strict';
// Edit mode (§3.5) and module options (§3.6). The editor changes the tab's template in memory, remounting the
// workspace after each change (instances whose id and type are unchanged are kept); Save writes it to storage,
// Discard restores the snapshot taken on entry. Built-ins are never edited: the first real change forks them (entering
// edit mode alone does not), and Discard drops that fork again.

const Editor = {
  active: false, snap: null, undo: [], redo: [], sel: null, drag: null, forked: null,
  ws(){ return Tpl.cur.workspaces.find(w => w.id === WS.wsId) || Tpl.cur.workspaces[0]; },
  changed(){ return !!this.snap && JSON.stringify(Tpl.cur) !== JSON.stringify(this.snap); },
  // The tab's template made user-owned: a built-in is forked once, with no dialog.
  own(){
    const t = Tpl.cur; if (!Tpl.isBuiltin(t.id)) return t;
    const f = Tpl.fork(t, `${t.name} (custom)`);
    if (this.active) this.forked = f.id;   // made by this edit session: Discard removes it
    Tpl.cur = f; lsSet('pitwall.active', f.id); writeHash(); renderTabs(true);
    Pit.say(`Built-ins are read-only: editing your copy '${f.name}'`);
    return f;
  },
  toggle(){ if (this.active) this.save(); else this.enter(); },
  enter(){
    if (this.active) return;
    if (WS.narrow) return Pit.say('Widen the window to edit layouts', 1);
    this.forked = null;
    this.snap = deep(Tpl.cur); this.undo = []; this.redo = []; this.active = true; this.sel = null;
    WS.mount(Tpl.cur, WS.wsId, true); renderTabs(true); this.renderBar(); renderKpi();
    Pit.emit('edit', true);
  },
  exit(){
    this.active = false; this.snap = null; this.forked = null; this.undo = []; this.redo = []; this.sel = null; this.closeDrawer();
    $('editBar').hidden = true; $('editBar').innerHTML = '';
    WS.mount(Tpl.cur, WS.wsId, false); renderTabs(true); renderKpi();
    Pit.emit('edit', false);
  },
  async save(){
    const t = Tpl.cur, raw = lsGet('pitwall.templates', null), stored = raw && Array.isArray(raw.items) ? raw.items.find(x => x && x.id === t.id) : null;
    if (stored && this.snap && this.snap.id === t.id && stored.updated !== this.snap.updated
      && await ask('This template was changed in another tab. Overwrite it?', [['ow', 'Overwrite', true], ['', 'Cancel']]) !== 'ow') return false;
    if (this.changed()) { Tpl.save(t); Pit.say(`Saved '${t.name}'`); }
    this.exit(); return true;
  },
  discard(){
    let r;
    if (this.forked) {   // the built-in this session forked: drop the fork, back to the built-in
      Tpl.remove(this.forked); r = Tpl.get(this.snap.id) || Tpl.get('builtin-race'); lsSet('pitwall.active', r.id);
    } else {
      const raw = lsGet('pitwall.templates', null), stored = raw && Array.isArray(raw.items) ? raw.items.find(x => x && x.id === this.snap.id) : null;
      if (stored && stored.updated !== this.snap.updated) { Tpl.load(); r = Tpl.get(this.snap.id); }   // saved in another tab meanwhile: that version, not the stale snapshot
      if (!r) { r = deep(this.snap); const i = Tpl.items.findIndex(x => x.id === r.id); if (i >= 0) Tpl.items[i] = r; }
    }
    Tpl.cur = r; if (!r.workspaces.some(w => w.id === WS.wsId)) WS.wsId = r.workspaces[0].id;
    this.exit(); writeHash(); renderTabs(true);
  },
  async leave(){   // Esc, or switching template while editing
    if (!this.active) return true;
    if (this.changed() && await ask('Discard changes?', [['d', 'Discard', true], ['', 'Keep editing']]) !== 'd') return false;
    this.discard(); return true;
  },
  // Every change: an undo snapshot, the change, a remount.
  change(fn, sel){
    this.own();   // the first change to a built-in forks it
    const before = deep(Tpl.cur);
    if (fn(Tpl.cur, this.ws()) === false) return false;
    this.undo.push(before); if (this.undo.length > 50) this.undo.shift(); this.redo = [];
    this.refresh(sel); return true;
  },
  refresh(sel){
    if (sel !== undefined) this.sel = sel;
    if (!Tpl.cur.workspaces.some(w => w.id === WS.wsId)) WS.wsId = Tpl.cur.workspaces[0].id;
    WS.mount(Tpl.cur, WS.wsId, true); renderTabs(true); this.renderBar(); this.markSel();
    writeHash();
  },
  step(from, to){ if (!from.length) return; to.push(deep(Tpl.cur)); const t = from.pop(); Object.keys(Tpl.cur).forEach(k => delete Tpl.cur[k]); Object.assign(Tpl.cur, t); this.refresh(); },

  // ---------- edit bar ----------
  renderBar(){
    if (!this.active) return;
    const b = $('editBar'), ws = this.ws(); b.hidden = false;
    if (!b.firstChild) {
      b.innerHTML = `<b class="eb-title">Editing</b><label class="eb-name"><span class="lbl">Workspace</span><input type="text" id="ebName" maxlength="20" aria-label="Workspace name"></label>
        <button type="button" class="btn" data-eb="add"><i data-lucide="plus"></i>Module</button>
        <button type="button" class="btn" data-eb="undo" title="Undo (Ctrl+Z)"><i data-lucide="undo-2"></i>Undo</button><button type="button" class="btn" data-eb="redo" title="Redo (Ctrl+Y)"><i data-lucide="redo-2"></i>Redo</button>
        <button type="button" class="btn" data-eb="reset">Reset workspace</button><span class="top-gap"></span><span class="note eb-hint">Drag a header to move, the corner to resize. Tab selects a module; arrows move it, Shift+arrows resize.</span>
        <button type="button" class="btn" data-eb="discard">Discard</button><button type="button" class="btn primary" data-eb="save" title="Save (Ctrl+S)">Save</button>`;
      refreshIcons(b);
    }
    const n = $('ebName'); if (document.activeElement !== n) n.value = ws.name;
    b.querySelector('[data-eb="undo"]').disabled = !this.undo.length; b.querySelector('[data-eb="redo"]').disabled = !this.redo.length;
  },

  // ---------- module operations ----------
  find(id){ const ws = this.ws(); return ws.modules.find(m => m.id === id); },
  move(id, x, y, w, h){   // refused when it would overlap or leave the grid
    const m = this.find(id); if (!m) return false;
    const def = Pit.registry.get(m.type), s = def ? def.size : {minW:1, minH:1};
    if (x < 0 || y < 0 || y > 199 || w < s.minW || h < s.minH || x + w > 12 || h > 60) return false;
    if (overlaps(this.ws().modules, m, x, y, w, h)) return false;
    if (m.x === x && m.y === y && m.w === w && m.h === h) return false;
    return this.change(() => Object.assign(this.find(id), {x, y, w, h}), id);
  },
  add(type){
    const def = Pit.registry.get(type), ws = this.ws(); if (!def) return;
    if (def.multi === false && ws.modules.some(m => m.type === type)) return Pit.say(`${def.title} is already in this workspace`, 1);
    if (ws.modules.length >= 40) return Pit.say('A workspace holds at most 40 modules', 1);
    const id = uniqueModId(Tpl.cur), at = freeSpot(ws.modules, def.size.w, def.size.h);
    this.change((t, w) => { w.modules.push({id, type, x:at.x, y:at.y, w:def.size.w, h:def.size.h, hidden:false, header:true, title:'', linked:!!def.linkable, options:sanitizeOptions(def, {}, () => {})}); }, id);
    const el = $(id); if (el) { el.scrollIntoView({block:'nearest'}); el.focus(); }
  },
  dup(id){
    const m = this.find(id); if (!m) return; const def = Pit.registry.get(m.type);
    if (def && def.multi === false) return Pit.say(`${def.title} can be in a workspace only once`, 1);
    const nid = uniqueModId(Tpl.cur), at = freeSpot(this.ws().modules, m.w, m.h);
    this.change((t, w) => { w.modules.push(Object.assign(deep(m), {id:nid, x:at.x, y:at.y})); }, nid);
  },
  remove(id){ this.change((t, w) => { const i = w.modules.findIndex(m => m.id === id); if (i < 0) return false; w.modules.splice(i, 1); }, null); },
  hide(id){ this.change(() => { const m = this.find(id); if (!m) return false; m.hidden = !m.hidden; }, id); },
  markSel(){ for (const i of WS.insts) i.el.classList.toggle('sel', i.id === this.sel); },
  select(id){ this.sel = id; this.markSel(); const el = id && $(id); if (el && document.activeElement !== el) el.focus({preventScroll:false}); },

  // ---------- workspaces (tabs) ----------
  addWs(){
    if (Tpl.cur.workspaces.length >= 9) return;
    const id = uniqueWsId(Tpl.cur, 'w-workspace');
    this.change(t => { t.workspaces.push({id, name:'Workspace', modules:[]}); });
    showWs(id); this.renderBar(); $('ebName').select();
  },
  wsAction(act, wsId){
    const t = Tpl.cur, i = t.workspaces.findIndex(w => w.id === wsId); if (i < 0) return;
    const w = t.workspaces[i];
    if (act === 'rename') { showWs(wsId); this.renderBar(); $('ebName').focus(); $('ebName').select(); return; }
    if (act === 'dup') {
      if (t.workspaces.length >= 9) return Pit.say('A template holds at most 9 workspaces', 1);
      const c = deep(w); c.id = uniqueWsId(t, w.id); c.name = `${w.name.slice(0, 13)} (copy)`;
      c.modules.forEach(m => { m.id = uniqueModId(t, c.modules); });
      this.change(tt => { tt.workspaces.splice(i + 1, 0, c); }); showWs(c.id); return;
    }
    if (act === 'left' || act === 'right') { const j = i + (act === 'left' ? -1 : 1); if (j < 0 || j >= t.workspaces.length) return; this.change(tt => { tt.workspaces.splice(j, 0, tt.workspaces.splice(i, 1)[0]); }); return; }
    if (act === 'del') {
      if (t.workspaces.length < 2) return Pit.say('The last workspace cannot be deleted', 1);
      ask(`Delete the workspace '${w.name}' and its ${w.modules.length} modules?`, [['del', 'Delete', true], ['', 'Cancel']]).then(v => {
        if (v !== 'del') return;
        const was = WS.wsId === wsId, nb = t.workspaces[i > 0 ? i - 1 : 1].id;   // the neighbour, taken before change() remounts
        this.change(tt => { tt.workspaces.splice(tt.workspaces.findIndex(x => x.id === wsId), 1); });
        if (was) showWs(nb);
      });
    }
  },
  async resetWs(){
    const bid = Tpl.isBuiltin(Tpl.cur.id) ? Tpl.cur.id : Tpl.cur.basedOn, ws = this.ws(), b = bid && BUILTIN_TEMPLATES.find(x => x.id === bid), src = b && b.workspaces.find(w => w.id === ws.id);
    if (await ask(src ? `Put '${ws.name}' back as in ${b.name}?` : `Empty the workspace '${ws.name}'?`, [['r', src ? 'Reset' : 'Empty', true], ['', 'Cancel']]) !== 'r') return;
    const base = src ? Tpl.builtins.find(x => x.id === b.id).workspaces.find(w => w.id === ws.id) : null;
    this.change((t, w) => { w.modules = []; if (base) for (const m of base.modules) w.modules.push(Object.assign(deep(m), {id:uniqueModId(t, w.modules)})); }, null);
  },

  // ---------- catalogue drawer ----------
  openDrawer(){
    const d = $('drawer'); d.hidden = false;
    d.innerHTML = `<header class="dlg-h"><h2>Add a module</h2><button type="button" class="btn icon" data-dr="close" aria-label="Close"><i data-lucide="x"></i></button></header>
      <input type="search" id="drQ" placeholder="Search modules" aria-label="Search modules"><div id="drList" class="dr-list"></div>`;
    refreshIcons(d); this.drawList(''); $('drQ').focus();
  },
  closeDrawer(){ const d = $('drawer'); d.hidden = true; d.innerHTML = ''; },
  drawList(q){
    q = q.trim().toLowerCase();
    const here = new Set(this.ws().modules.map(m => m.type)), groups = new Map();
    for (const def of Pit.registry.values()) {
      if (q && !`${def.title} ${def.blurb} ${def.group} ${def.type}`.toLowerCase().includes(q)) continue;
      if (!groups.has(def.group)) groups.set(def.group, []); groups.get(def.group).push(def);
    }
    const ORDER = ['Timing', 'Strategy', 'Pit', 'Car', 'Laps', 'Analysis', 'Log'];
    const gs = [...groups.keys()].sort((a, b) => (ORDER.indexOf(a) + 1 || 99) - (ORDER.indexOf(b) + 1 || 99));
    $('drList').innerHTML = gs.length ? gs.map(g => `<h3 class="lbl">${esc(g)}</h3>${groups.get(g).map(d => { const off = d.multi === false && here.has(d.type);
      return `<button type="button" class="dr-item" data-add="${esc(d.type)}"${off ? ' disabled' : ''}><b>${esc(d.title)}</b><span class="note">${esc(d.blurb)}</span><span class="n dr-size">${d.size.w}×${d.size.h}${off ? ' · already here' : ''}</span></button>`; }).join('')}`).join('')
      : `<p class="empty">${Pit.registry.size ? 'No module matches.' : 'No modules are installed in this version.'}</p>`;
  },

  // ---------- keyboard (main.js gives the editor first refusal while active) ----------
  key(e){
    const k = e.key, ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && (k === 's' || k === 'S')) { e.preventDefault(); this.save(); return true; }
    if (ctrl && !e.shiftKey && (k === 'z' || k === 'Z')) { e.preventDefault(); this.step(this.undo, this.redo); return true; }
    if (ctrl && (k === 'y' || k === 'Y' || (e.shiftKey && (k === 'z' || k === 'Z')))) { e.preventDefault(); this.step(this.redo, this.undo); return true; }
    if (k === 'Escape') {
      e.preventDefault();
      if (!$('drawer').hidden) { this.closeDrawer(); return true; }
      if (/^(input|textarea|select)$/i.test(e.target.tagName)) { e.target.blur(); return true; }
      this.leave(); return true;
    }
    if (/^(input|textarea|select)$/i.test(e.target.tagName) || ctrl || e.altKey) return false;
    const mods = this.ws().modules.slice().sort((a, b) => a.y - b.y || a.x - b.x);
    if (k === 'Tab' && mods.length) {
      e.preventDefault(); const i = mods.findIndex(m => m.id === this.sel), n = mods.length;
      this.select(mods[i < 0 ? (e.shiftKey ? n - 1 : 0) : (i + (e.shiftKey ? -1 : 1) + n) % n].id); return true;
    }
    if (k === 'e' || k === 'E') { e.preventDefault(); this.save(); return true; }
    const m = this.sel && this.find(this.sel); if (!m) return false;
    const arrows = {ArrowLeft:[-1, 0], ArrowRight:[1, 0], ArrowUp:[0, -1], ArrowDown:[0, 1]}[k];
    if (arrows) { e.preventDefault(); const [dx, dy] = arrows; if (e.shiftKey) this.move(m.id, m.x, m.y, m.w + dx, m.h + dy); else this.move(m.id, m.x + dx, m.y + dy, m.w, m.h); return true; }
    if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); this.remove(m.id); return true; }
    if (k === 'd' || k === 'D') { e.preventDefault(); this.dup(m.id); return true; }
    if (k === 'h' || k === 'H') { e.preventDefault(); this.hide(m.id); return true; }
    if (k === 'o' || k === 'O') { e.preventDefault(); const inst = WS.insts.find(i => i.id === m.id); if (inst) this.options(inst); return true; }
    return false;
  },

  // ---------- module options (#dlgModule) ----------
  optId: null,
  options(inst){
    if (!inst || !inst.def) return;
    this.optId = inst.id; this.drawOptions(); if (!$('dlgModule').open) $('dlgModule').showModal();
  },
  drawOptions(){
    const d = $('dlgModule'), m = this.modById(this.optId); if (!m) { d.close(); return; }
    const def = Pit.registry.get(m.type), o = m.options || {};
    const field = op => {
      const v = o[op.key] !== undefined ? o[op.key] : op.def, id = `mo-${esc(op.key)}`, ch = (op.choices || []).map(c => Array.isArray(c) ? c : [c, String(c)]);
      if (op.type === 'select') return `<label class="fld"><span>${esc(op.label)}</span><select id="${id}" data-o="${esc(op.key)}">${ch.map(([cv, cl]) => `<option value="${esc(cv)}"${cv === v ? ' selected' : ''}>${esc(cl)}</option>`).join('')}</select></label>`;
      if (op.type === 'number') return `<label class="fld"><span>${esc(op.label)}</span><input type="number" id="${id}" data-o="${esc(op.key)}" value="${esc(v)}"${op.min != null ? ` min="${op.min}"` : ''}${op.max != null ? ` max="${op.max}"` : ''} step="${op.step || 1}"></label>`;
      if (op.type === 'toggle') return `<label class="fld check"><input type="checkbox" id="${id}" data-o="${esc(op.key)}"${v ? ' checked' : ''}><span>${esc(op.label)}</span></label>`;
      if (op.type === 'text') return `<label class="fld"><span>${esc(op.label)}</span><input type="text" id="${id}" data-o="${esc(op.key)}" maxlength="40" value="${esc(v)}"></label>`;
      if (op.type === 'multi') {
        const on = Array.isArray(v) ? v : [], rows = [...on.filter(x => ch.some(c => c[0] === x)), ...ch.map(c => c[0]).filter(x => !on.includes(x))];
        return `<fieldset class="fld multi"><legend>${esc(op.label)}</legend>${rows.map(x => { const lab = (ch.find(c => c[0] === x) || [x, x])[1], sel = on.includes(x);
          return `<div class="mrow"><label class="check"><input type="checkbox" data-m="${esc(op.key)}" value="${esc(x)}"${sel ? ' checked' : ''}><span>${esc(lab)}</span></label>${sel ? `<button type="button" class="btn icon" data-mv="${esc(op.key)}" data-x="${esc(x)}" data-d="-1" aria-label="Move ${esc(lab)} up">↑</button><button type="button" class="btn icon" data-mv="${esc(op.key)}" data-x="${esc(x)}" data-d="1" aria-label="Move ${esc(lab)} down">↓</button>` : ''}</div>`; }).join('')}</fieldset>`;
      }
      return '';
    };
    d.innerHTML = `<form method="dialog" class="dlg-body"><header class="dlg-h"><h2>${esc(m.title || def.title)} <span class="note">options</span></h2><button class="btn icon" value="" aria-label="Close"><i data-lucide="x"></i></button></header>
      <div class="dlg-scroll">
        <label class="fld"><span>Title</span><input type="text" data-c="title" maxlength="40" value="${esc(m.title || '')}" placeholder="${esc(def.title)}"></label>
        ${def.linkable ? `<label class="fld check"><input type="checkbox" data-c="linked"${m.linked !== false ? ' checked' : ''}><span>Follow the focus car</span></label>` : ''}
        <label class="fld check"><input type="checkbox" data-c="header"${m.header !== false ? ' checked' : ''}><span>Show header</span></label>
        ${def.options.map(field).join('')}
      </div>
      <div class="dlg-foot"><span class="note">${Editor.active ? 'Saved with the layout.' : Tpl.isBuiltin(Tpl.cur.id) ? 'A change makes your own copy of this built-in template.' : 'Changes are saved at once.'}</span><button type="button" class="btn" data-reset>Reset options</button><button class="btn primary" value="">Done</button></div></form>`;
    refreshIcons(d);
  },
  modById(id){ for (const w of Tpl.cur.workspaces) { const m = w.modules.find(x => x.id === id); if (m) return m; } return null; },
  // An options change: with the editor, an undoable change; in view mode, saved at once (forking a built-in first).
  setOpt(fn){
    const id = this.optId;
    if (this.active) { this.change(() => { const m = this.modById(id); if (!m) return false; fn(m, Pit.registry.get(m.type)); }, id); }
    else {
      const t = this.own(), m = t.workspaces.flatMap(w => w.modules).find(x => x.id === id); if (!m) return;
      fn(m, Pit.registry.get(m.type)); Tpl.save(t); WS.mount(t, WS.wsId, false);
    }
    this.drawOptions();
  },
};
const uniqueModId = (t, extra = []) => { const used = new Set([...t.workspaces.flatMap(w => w.modules), ...extra].map(m => m.id)); let id; do id = Tpl.newId('m-'); while (used.has(id)); return id; };
const uniqueWsId = (t, base) => { const used = new Set(t.workspaces.map(w => w.id)); base = base.slice(0, 11); let id = base, k = 2; while (used.has(id)) id = `${base}-${k++}`; return id; };
const overlaps = (mods, self, x, y, w, h) => mods.some(o => o !== self && x < o.x + o.w && o.x < x + w && y < o.y + o.h && o.y < y + h);

// ---------- events ----------
$('editBar').addEventListener('click', e => {
  const b = e.target.closest('[data-eb]'); if (!b) return;
  const E = Editor;
  ({add:() => $('drawer').hidden ? E.openDrawer() : E.closeDrawer(), undo:() => E.step(E.undo, E.redo), redo:() => E.step(E.redo, E.undo), reset:() => E.resetWs(),
    discard:() => E.leave(), save:() => E.save()})[b.dataset.eb]();
});
$('editBar').addEventListener('change', e => {
  if (e.target.id !== 'ebName') return;
  const n = cleanText(e.target.value, 20) || 'Workspace';
  Editor.change((t, w) => { if (w.name === n) return false; w.name = n; });
});
$('drawer').addEventListener('input', e => { if (e.target.id === 'drQ') Editor.drawList(e.target.value); });
$('drawer').addEventListener('click', e => {
  if (e.target.closest('[data-dr="close"]')) return Editor.closeDrawer();
  const b = e.target.closest('[data-add]'); if (b && !b.disabled) Editor.add(b.dataset.add);
});
$('tabs').addEventListener('click', e => {
  if (!Editor.active) return;
  if (e.target.closest('#tabAdd')) return Editor.addWs();
  const b = e.target.closest('[data-wsmenu]'); if (!b) return;
  let p = $('wsMenu');
  if (!p) { p = document.createElement('div'); p.id = 'wsMenu'; p.className = 'pop'; p.setAttribute('popover', ''); p.setAttribute('role', 'menu'); document.body.appendChild(p);
    p.addEventListener('click', ev => { const a = ev.target.closest('[data-wa]'); if (!a) return; p.hidePopover(); Editor.wsAction(a.dataset.wa, p.dataset.ws); }); }
  p.dataset.ws = b.dataset.wsmenu;
  p.innerHTML = [['rename', 'Rename'], ['dup', 'Duplicate'], ['left', 'Move left'], ['right', 'Move right'], ['del', 'Delete']].map(([a, l]) => `<button type="button" role="menuitem" data-wa="${a}">${l}</button>`).join('');
  const r = b.getBoundingClientRect(); p.style.inset = 'auto'; p.style.margin = '0'; p.style.left = r.left + 'px'; p.style.top = r.bottom + 4 + 'px';
  p.showPopover(); const f = p.querySelector('button'); if (f) f.focus();
});
// Module buttons in edit mode, and selecting a module by clicking it.
$('ws').addEventListener('click', e => {
  if (!Editor.active) return;
  const mod = e.target.closest('.mod'); if (!mod) return;
  const b = e.target.closest('.medit [data-act]');
  if (!b) { if (!e.target.closest('button, input, select, textarea, a')) Editor.select(mod.id); return; }
  const id = mod.id;
  ({opts:() => Editor.options(WS.insts.find(i => i.id === id)), dup:() => Editor.dup(id), hide:() => Editor.hide(id), remove:() => Editor.remove(id), drag:() => Editor.select(id)})[b.dataset.act]();
});
// Move by the header, resize by the corner grip: snapped to cells, with a ghost showing the target.
$('ws').addEventListener('pointerdown', e => {
  if (!Editor.active || e.button !== 0) return;
  const grip = e.target.closest('.mgrip'), head = e.target.closest('.mh');
  if (!grip && (!head || (e.target.closest('button') && !e.target.closest('[data-act="drag"]')))) return;
  const mod = e.target.closest('.mod'), m = Editor.find(mod.id); if (!m) return;
  e.preventDefault(); Editor.select(m.id);
  const host = $('ws'), cs = getComputedStyle(host), gx = parseFloat(cs.columnGap) || 8, gy = parseFloat(cs.rowGap) || 8;
  const cw = (host.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0) - 11 * gx) / 12 + gx, rh = (parseFloat(cs.gridAutoRows) || 28) + gy;
  const g = document.createElement('div'); g.className = 'ghost'; g.setAttribute('aria-hidden', 'true'); host.appendChild(g);
  const def = Pit.registry.get(m.type), s = def ? def.size : {minW:1, minH:1}, x0 = e.clientX, y0 = e.clientY;
  let r = {x:m.x, y:m.y, w:m.w, h:m.h}, bad = false;
  const show = () => {
    bad = overlaps(Editor.ws().modules, m, r.x, r.y, r.w, r.h);
    g.classList.toggle('bad', bad); g.textContent = bad ? 'occupied' : `${r.w}×${r.h}`;
    g.style.gridColumn = `${r.x + 1} / span ${r.w}`; g.style.gridRow = `${r.y + 1} / span ${r.h}`;
  };
  show();
  const move = ev => {
    const dx = Math.round((ev.clientX - x0) / cw), dy = Math.round((ev.clientY - y0) / rh);
    r = grip ? {x:m.x, y:m.y, w:clamp(m.w + dx, s.minW, 12 - m.x), h:clamp(m.h + dy, s.minH, 60)} : {x:clamp(m.x + dx, 0, 12 - m.w), y:clamp(m.y + dy, 0, 199), w:m.w, h:m.h};
    show();
  };
  const up = () => {
    window.removeEventListener('pointermove', move); g.remove();
    if (!bad) Editor.move(m.id, r.x, r.y, r.w, r.h);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up, {once:true});
});
// Options dialog: every change applies live.
$('dlgModule').addEventListener('change', e => {
  const t = e.target;
  if (t.dataset.c === 'title') return Editor.setOpt(m => { m.title = cleanText(t.value, 40); });
  if (t.dataset.c === 'linked') return Editor.setOpt(m => { m.linked = t.checked; });
  if (t.dataset.c === 'header') return Editor.setOpt(m => { m.header = t.checked; });
  if (t.dataset.o) return Editor.setOpt((m, def) => {
    const op = def.options.find(o => o.key === t.dataset.o), v = op.type === 'toggle' ? t.checked : op.type === 'number' ? +t.value : t.value;
    m.options = sanitizeOptions(def, Object.assign({}, m.options, {[op.key]:v}), () => {});
  });
  if (t.dataset.m) return Editor.setOpt((m, def) => {
    const k = t.dataset.m, cur = (m.options[k] || []).filter(x => x !== t.value);
    if (t.checked) cur.push(t.value);
    m.options = sanitizeOptions(def, Object.assign({}, m.options, {[k]:cur}), () => {});
  });
});
$('dlgModule').addEventListener('click', e => {
  const mv = e.target.closest('[data-mv]');
  if (mv) return Editor.setOpt((m, def) => {
    const k = mv.dataset.mv, a = (m.options[k] || []).slice(), i = a.indexOf(mv.dataset.x), j = i + +mv.dataset.d;
    if (i < 0 || j < 0 || j >= a.length) return; a.splice(j, 0, a.splice(i, 1)[0]);
    m.options = sanitizeOptions(def, Object.assign({}, m.options, {[k]:a}), () => {});
  });
  if (e.target.closest('[data-reset]')) Editor.setOpt((m, def) => { m.options = sanitizeOptions(def, {}, () => {}); m.title = ''; m.header = true; m.linked = !!def.linkable; });
});
Pit.on('workspace', () => { if (Editor.active) { Editor.renderBar(); Editor.markSel(); if (!$('drawer').hidden) Editor.drawList($('drQ').value); } });
