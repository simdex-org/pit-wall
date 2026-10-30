'use strict';
// Settings (§7.5): a full-screen overlay (gear button or ","; Esc closes) with a list of sections. Units, layout and
// appearance belong to this browser; thresholds and strategy inputs are the bridge's config, shared with everyone
// watching it, and change only through POST /config with the access key.

const SET_SECTIONS = [['conn', 'Connection'], ['units', 'Units'], ['th', 'Thresholds'], ['strat', 'Strategy inputs'], ['layout', 'Layout'],
  ['ap', 'Appearance'], ['tpl', 'Templates'], ['data', 'Data'], ['about', 'About']];
const STRAT_FIELDS = [   // [key, label, min, max, step, nullable, unit]
  ['reserve_laps', 'Reserve fuel', 0, 10, 0.5, false, 'laps'], ['laps_override', 'Laps to go, by hand', 1, 999, 1, true, 'laps'],
  ['pit_loss_s', 'Pit lane loss, driving (until a stop is measured)', 0, 200, 0.1, false, 's'], ['refuel_s_per_l', 'Refuel time', 0, 5, 0.01, false, 's/L'],
  ['tyre_s', 'Tyre change time', 0, 120, 0.5, false, 's'], ['min_stationary_s', 'Minimum stationary time', 0, 200, 0.5, false, 's'],
  ['mandatory_stops', 'Mandatory stops (server rule)', 0, 9, 1, true, ''], ['pit_window_open_min', 'Pit window opens', 0, 1440, 1, true, 'min after green'],
  ['pit_window_close_min', 'Pit window closes', 0, 1440, 1, true, 'min after green']];
const Settings = {
  sec: 'conn', thClass: null, msg: '',
  open(){ const s = $('settings'); s.hidden = false; this.msg = ''; this.draw(); s.querySelector('.set-nav [aria-selected="true"]').focus(); },
  close(){ const s = $('settings'); s.hidden = true; s.innerHTML = ''; const b = $('btnSettings'); if (b) b.focus(); },
  draw(){
    const s = $('settings');
    s.innerHTML = `<div class="set"><header class="set-h"><h2>Settings</h2><button type="button" class="btn icon" data-set="close" aria-label="Close settings" title="Close (Esc)"><i data-lucide="x"></i></button></header>
      <nav class="set-nav" role="tablist" aria-orientation="vertical">${SET_SECTIONS.map(([k, l]) => `<button type="button" role="tab" data-sec="${k}" aria-selected="${k === this.sec}">${l}</button>`).join('')}</nav>
      <div class="set-pane" role="tabpanel" id="setPane">${this.pane()}</div></div>`;
    if (this.sec === 'ap') Appearance.render($('apHost'));
    refreshIcons(s);
  },
  say(t){ this.msg = t; const m = $('setMsg'); if (m) m.textContent = t; },
  pane(){
    const msg = `<p class="note set-msg" id="setMsg" role="status">${esc(this.msg)}</p>`, key = !!Pit.key;
    const keyNote = key ? '' : '<p class="note"><i data-lucide="lock"></i> Needs the access key: set it under Connection.</p>';
    switch (this.sec) {
      case 'conn': {
        const bc = ctx.bc;
        return `<h3 class="mt">Connection</h3><dl class="kv">
          <dt>Bridge</dt><dd class="n">${esc(location.host)}</dd><dt>Link</dt><dd id="setLink">${esc($('link').textContent)} · ${ctx.live ? Math.round(D.rx.length / 2) : 0} Hz</dd></dl>
          <label class="fld"><span>Live rate</span><select data-pref="hz">${[5, 10, 15, 30].map(v => `<option value="${v}"${Pit.prefs.hz === v ? ' selected' : ''}>${v} Hz</option>`).join('')}</select></label>
          <p class="note">Lower rates use less of the VPN. Laps, strategy and timing are unaffected.</p>
          <h3 class="mt">Access key</h3><p>${key ? '<b class="tag">SET</b>' : '<b class="tag low">MISSING</b>'} The key printed by bridge.py on the driver's PC. Needed to send pit plans and change shared thresholds.</p>
          <div class="split"><input type="password" id="setKey" autocomplete="off" spellcheck="false" placeholder="Paste the key" aria-label="Access key"><button type="button" class="btn" data-set="key">Save</button>${key ? '<button type="button" class="btn" data-set="forget">Forget</button>' : ''}</div>
          <h3 class="mt">Field timing</h3><p>${bc ? `<b class="tag">${esc(String(bc.state || 'off').toUpperCase())}</b> ${esc(bc.msg || '')}${bc.port ? ` · port ${esc(bc.port)}` : ''}` : 'This bridge does not report field timing.'}</p>
          <p class="note">Other cars come from ACC's broadcasting port, on the driver's PC only. To turn it on there: <code>python server/acc_broadcast.py --enable</code>, then restart ACC.</p>${msg}`;
      }
      case 'units': {
        const sel = (k, label) => `<label class="fld"><span>${label}</span><select data-unit="${k}">${Object.entries(UNITS[k]).map(([v, u]) => `<option value="${v}"${Pit.prefs.units[k] === v ? ' selected' : ''}>${u.u}</option>`).join('')}</select></label>`;
        return `<h3 class="mt">Units</h3>${sel('speed', 'Speed (also wind)')}${sel('temp', 'Temperature')}${sel('press', 'Pressure')}<p class="note">Display only: the bridge and the shared thresholds stay in km/h, °C and psi.</p>`;
      }
      case 'th': {
        const cls = this.thClass || (ctx.r && ctx.r.fixed.car_class) || 'GT3', T = ctx.cfg && ctx.cfg.thresholds, t = T ? T[cls] || T.GT3 : DEF_TH;
        const copy = cls !== 'GT3' && T && JSON.stringify(T[cls]) === JSON.stringify(T.GT3);
        const pu = un('press').u, tu = un('temp').u, dis = key ? '' : ' disabled';
        const pair = (id, label, kind, v) => `<div class="fld pair"><span>${label}</span><input type="number" step="any" data-th="${id}.0" data-k="${kind}" data-v="${esc(v[0])}" value="${esc(fv(kind, v[0]))}"${dis} aria-label="${label}, low"><span>–</span><input type="number" step="any" data-th="${id}.1" data-k="${kind}" data-v="${esc(v[1])}" value="${esc(fv(kind, v[1]))}"${dis} aria-label="${label}, high"><span class="u">${esc(un(kind).u)}</span></div>`;
        return `<h3 class="mt">Thresholds <span class="note">shared</span></h3>
          ${lsRaw('pitwall.oldThresholds') ? `<div class="banner"><i data-lucide="info"></i><span>This browser had custom thresholds.</span><button type="button" class="btn" data-old="send">Send to bridge</button><button type="button" class="btn" data-old="discard">Discard</button></div>` : ''}
          <p class="banner"><i data-lucide="users"></i>Shared with everyone watching this bridge.</p>${keyNote}
          ${T ? '' : '<p class="note">The bridge has not sent its config: showing the GT3 defaults.</p>'}
          <label class="fld"><span>Class</span><select id="thClass">${CLASSES.map(c => `<option${c === cls ? ' selected' : ''}>${c}</option>`).join('')}</select></label>
          ${copy ? '<p class="note s-warn">▲ Defaults copied from GT3: check for this class.</p>' : ''}
          ${pair('dry_psi', 'Hot pressure, dry', 'press', t.dry_psi)}${pair('wet_psi', 'Hot pressure, wet', 'press', t.wet_psi)}${pair('tyre_c', 'Tyre core', 'temp', t.tyre_c)}
          ${pair('brake_c.front', 'Front brakes, cold / hot', 'temp', t.brake_c.front)}${pair('brake_c.rear', 'Rear brakes, cold / hot', 'temp', t.brake_c.rear)}
          ${pair('water_c', 'Water, warn / critical', 'temp', t.water_c)}
          <label class="fld"><span>Pads low</span><input type="number" step="0.5" data-th="pad_low_mm" value="${esc(t.pad_low_mm)}"${dis}><span class="u">mm</span></label>
          <label class="fld"><span>Low fuel</span><input type="number" step="0.5" data-th="fuel_low_laps" value="${esc(ctx.cfg && ctx.cfg.fuel_low_laps != null ? ctx.cfg.fuel_low_laps : 3)}"${dis}><span class="u">laps</span></label>
          <p class="note">Pressures in ${esc(pu)}, temperatures in ${esc(tu)}. Brakes warn within 100 °C of hot.</p>
          <button type="button" class="btn primary" data-set="saveTh"${dis}>Save for ${esc(cls)}</button>${msg}`;
      }
      case 'strat': {
        const st = ctx.cfg && ctx.cfg.strategy || {}, dis = key ? '' : ' disabled';
        return `<h3 class="mt">Strategy inputs <span class="note">shared</span></h3><p class="banner"><i data-lucide="users"></i>Shared with everyone watching this bridge. The fuel and stop figures everywhere come from these.</p>${keyNote}
          ${STRAT_FIELDS.map(([k, l, lo, hi, step, nul, u]) => `<label class="fld"><span>${esc(l)}</span><input type="number" data-st="${k}" min="${lo}" max="${hi}" step="${step}" value="${st[k] == null ? '' : esc(st[k])}"${nul ? ' placeholder="not set"' : ''}${dis}><span class="u">${esc(u)}</span></label>`).join('')}
          <label class="fld"><span>Fuel and tyres at a stop</span><select data-st="fuel_and_tyres"${dis}>${[['parallel', 'At the same time (longest counts)'], ['sequential', 'One after the other (added)']].map(([v, l]) => `<option value="${v}"${st.fuel_and_tyres === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
          <p class="note">Pit window: both or neither. Empty fields mean "not set": the bridge uses what ACC reports.</p>
          <button type="button" class="btn primary" data-set="saveSt"${dis}>Save</button>${msg}`;
      }
      case 'layout': {
        const on = Pit.prefs.kpi, rest = KPI_IDS.filter(k => !on.includes(k));
        return `<h3 class="mt">KPI strip</h3><label class="fld check"><input type="checkbox" data-pref="kpiOn"${Pit.prefs.kpiOn ? ' checked' : ''}><span>Show the KPI strip</span></label>
          <ul class="kpi-pick">${[...on, ...rest].map(k => `<li><label class="check"><input type="checkbox" data-kpi="${k}"${on.includes(k) ? ' checked' : ''}><span>${esc(KPI_LABEL[k])}</span>${KPI_OFF.has(k) ? ' <span class="note">hidden: window too narrow</span>' : ''}</label>${on.includes(k) ? `<button type="button" class="btn icon" data-kmv="${k}" data-d="-1" aria-label="Move ${esc(KPI_LABEL[k])} left">↑</button><button type="button" class="btn icon" data-kmv="${k}" data-d="1" aria-label="Move ${esc(KPI_LABEL[k])} right">↓</button>` : ''}</li>`).join('')}</ul>
          <p class="note">Cells drop from the end when the window is too narrow.</p>
          <h3 class="mt">Engineer bar</h3><label class="fld check"><input type="checkbox" data-pref="sound"${Pit.prefs.sound ? ' checked' : ''}><span>Beep on new critical advice</span></label>`;
      }
      case 'ap': return '<div id="apHost"></div>';
      case 'tpl': return `<h3 class="mt">Templates</h3><p>A template is a set of workspaces. Make your own, share them by export and import.</p><button type="button" class="btn primary" data-set="tpl">Manage templates…</button>`;
      case 'data': {
        const has = typeof exportSession === 'function';
        return `<h3 class="mt">Data</h3><div class="split"><button type="button" class="btn" data-set="expSession"${has ? '' : ' disabled'}>Export session</button>
          <label class="btn">Import laps<input type="file" accept=".json,application/json" hidden id="setImpLaps"${typeof importLaps === 'function' ? '' : ' disabled'}></label></div>
          <p class="note">The session file holds the laps, traces, log and notes this page has. Imported laps appear in the lap picker.</p>
          <h3 class="mt">This browser</h3><button type="button" class="btn" data-set="reset">Reset everything in this browser</button>
          <p class="note">Removes your templates, appearances, units, notes, pit plan draft and the access key from this browser. Nothing on the bridge changes.</p>${msg}`;
      }
      case 'about': return `<h3 class="mt">About</h3><p><b>Pit Wall 2.0</b>: race engineering for Assetto Corsa Competizione.</p>
        <ul class="note"><li>Barlow Semi Condensed and JetBrains Mono: SIL Open Font License 1.1.</li><li>Lucide icons: ISC License.</li></ul>`;
    }
    return '';
  },
  async click(b){
    const a = b.dataset.set;
    if (a === 'close') return this.close();
    if (a === 'key') { const v = $('setKey').value.trim(); if (!v) return; Pit.key = v; lsSet('pitwall.pitkey', v); this.msg = 'Access key saved in this browser.'; Pit.dirty('pit'); }
    if (a === 'forget') { Pit.key = ''; lsDel('pitwall.pitkey'); lsDel('engineer.pitkey'); this.msg = 'Access key removed from this browser.'; Pit.dirty('pit'); }
    if (a === 'saveTh') return this.saveTh();
    if (a === 'saveSt') return this.saveSt();
    if (a === 'tpl') return Manager.open();
    if (a === 'expSession') { exportSession(); return; }
    if (a === 'reset') {
      if (await ask('Reset everything Pit Wall keeps in this browser? Your templates, appearances and notes will be gone.', [['r', 'Reset', true], ['', 'Cancel']]) !== 'r') return;
      try { for (const k of Object.keys(localStorage)) if (k.startsWith('pitwall.') || k === 'engineer.pitkey') localStorage.removeItem(k); localStorage.setItem('pitwall.migrated', '1'); } catch (e) {}
      location.replace(location.pathname); return;
    }
    this.draw();
  },
  async post(body, ok){
    const r = await Pit.post('/config', body);
    this.say(r.ok ? ok : r.status === 403 ? 'Wrong or missing access key.' : r.status === 0 ? r.text : r.status === 404 ? 'This bridge does not take shared settings yet.' : 'Refused: ' + r.text.slice(0, 120));
    if (r.ok) { try { const c = numbersOnly(JSON.parse(r.text)); if (isObj(c) && c.thresholds) { ctx.cfg = c; Pit.dirty('config'); Pit.emit('config', c); } } catch (e) {} }
    return r.ok;
  },
  saveTh(){
    const cls = this.thClass || (ctx.r && ctx.r.fixed.car_class) || 'GT3', o = {}, pane = $('setPane');
    let bad = '';
    for (const i of pane.querySelectorAll('[data-th]')) {
      const v = parseFloat(i.value); if (!isFinite(v)) { bad = 'Every threshold needs a number.'; break; }
      // an untouched field sends its stored value: converting the rounded display value back would drift it (bar/kPa -> psi)
      const val = i.dataset.v != null && i.value === i.defaultValue ? +i.dataset.v : i.dataset.k ? +UNITS[i.dataset.k][Pit.prefs.units[i.dataset.k]].b(v).toFixed(2) : v, path = i.dataset.th.split('.');
      if (path[0] === 'fuel_low_laps') continue;
      let p = o; for (let j = 0; j < path.length - 1; j++) { const k = isFinite(path[j + 1]) ? [] : {}; p = p[path[j]] = p[path[j]] || k; }
      p[path[path.length - 1]] = val;
    }
    if (bad) return this.say(bad);
    const fl = parseFloat(pane.querySelector('[data-th="fuel_low_laps"]').value);
    return this.post({thresholds:{[cls]:o}, fuel_low_laps:isFinite(fl) ? fl : 3}, `Saved for ${cls}: everyone watching sees the change.`);
  },
  saveSt(){
    const st = {};
    for (const i of $('setPane').querySelectorAll('[data-st]')) {
      const k = i.dataset.st;
      if (k === 'fuel_and_tyres') { st[k] = i.value; continue; }
      const f = STRAT_FIELDS.find(x => x[0] === k), v = i.value.trim();
      if (v === '') { if (f[5]) st[k] = null; else return this.say(`${f[1]} needs a number.`); continue; }
      const n = parseFloat(v); if (!isFinite(n) || n < f[2] || n > f[3]) return this.say(`${f[1]}: ${f[2]} to ${f[3]}.`);
      st[k] = f[4] === 1 ? Math.round(n) : n;
    }
    if ((st.pit_window_open_min == null) !== (st.pit_window_close_min == null)) return this.say('Pit window: set both times, or neither.');
    return this.post({strategy:st}, 'Strategy inputs saved: everyone watching sees the change.');
  },
};

// ---------- events, delegated on the overlay ----------
$('settings').addEventListener('click', e => {
  const sec = e.target.closest('[data-sec]'); if (sec) { Settings.sec = sec.dataset.sec; Settings.msg = ''; Settings.draw(); $('settings').querySelector(`[data-sec="${sec.dataset.sec}"]`).focus(); return; }
  const b = e.target.closest('[data-set]'); if (b) return Settings.click(b);
  const old = e.target.closest('[data-old]'); if (old) return Manager.resolveOld(old.dataset.old === 'send').then(() => { renderBanner(); Settings.draw(); });
  const mv = e.target.closest('[data-kmv]');
  if (mv) { const a = Pit.prefs.kpi, i = a.indexOf(mv.dataset.kmv), j = i + +mv.dataset.d; if (i >= 0 && j >= 0 && j < a.length) { a.splice(j, 0, a.splice(i, 1)[0]); Pit.savePrefs(); Pit.dirty('kpi'); Settings.draw(); } }
});
$('settings').addEventListener('keydown', e => {
  const t = e.target; if (!t.matches('.set-nav [role="tab"]')) return;
  const d = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0; if (!d) return;
  e.preventDefault(); const i = SET_SECTIONS.findIndex(s => s[0] === Settings.sec);
  Settings.sec = SET_SECTIONS[(i + d + SET_SECTIONS.length) % SET_SECTIONS.length][0]; Settings.draw(); $('settings').querySelector(`[data-sec="${Settings.sec}"]`).focus();
});
$('settings').addEventListener('change', async e => {
  const t = e.target, P = Pit.prefs;
  if (t.dataset.unit) { P.units[t.dataset.unit] = t.value; Pit.savePrefs(); Pit.dirty('units'); Pit.emit('units', P.units); return; }
  if (t.dataset.pref === 'hz') { P.hz = +t.value; Pit.savePrefs(); Pit.reconnect(); Settings.say(`Live rate ${P.hz} Hz.`); return; }
  if (t.dataset.pref === 'kpiOn') { P.kpiOn = t.checked; Pit.savePrefs(); Pit.dirty('kpi'); return; }
  if (t.dataset.pref === 'sound') { P.sound = t.checked; Pit.savePrefs(); if (t.checked) beep(); return; }
  if (t.dataset.kpi) { P.kpi = t.checked ? [...P.kpi, t.dataset.kpi] : P.kpi.filter(k => k !== t.dataset.kpi); Pit.savePrefs(); Pit.dirty('kpi'); Settings.draw(); setTimeout(() => Settings.draw(), 150); return; }   // again once the strip has measured what fits
  if (t.id === 'thClass') { Settings.thClass = t.value; Settings.msg = ''; Settings.draw(); return; }
  if (t.id === 'setImpLaps' && t.files[0]) { const m = await importLaps(t.files[0]); t.value = ''; Pit.dirty('rec'); Settings.say(m || 'Imported.'); }
});
// The connection line keeps up while the pane is open.
WS.hooks.push(d => { if (d.has('tick') && !$('settings').hidden && $('setLink')) $('setLink').textContent = `${$('link').textContent} · ${ctx.live ? Math.round(D.rx.length / 2) : 0} Hz`; });
