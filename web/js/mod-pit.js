'use strict';
// mod-pit.js (D1): pit-plan, pit-log, press-fix. The plan is typed into the driver's MFD by the bridge (POST /pit with
// X-Pit-Key), the whole plan or one block; fuel, tyre set and pressures are read back from the game, the rest is "sent".
(() => {
  const PADS = [[1, '1'], [2, '2'], [3, '3'], [4, '4']];
  const GROUPS = [['Fuel', 'fuel', [['fuel', 'Fuel to add', 'number', 0, 150, 1, 'L']]],
    ['Tyres', 'tyres', [['tyres', 'Change tyres', 'check'], ['tyre_set', 'Tyre set', 'number', 1, 50, 1, ''], ['compound', 'Compound', 'select', [['dry', 'Dry'], ['wet', 'Wet']]]]],
    ['Pressures', 'pressures', CORNERS.map((c, i) => ['p' + i, c, 'press'])],
    ['Brakes', 'brakes', [['brakes', 'Change brakes', 'check'], ['front_pad', 'Front pads', 'select', PADS], ['rear_pad', 'Rear pads', 'select', PADS]]],
    ['Repairs', 'repairs', [['flip_suspension', 'Suspension (switch)', 'check'], ['flip_bodywork', 'Bodywork (switch)', 'check']]]];
  const LABEL = Object.fromEntries(GROUPS.flatMap(([, , rows]) => rows.map(r => [r[0], r[1]])));
  const GROUP_OF = Object.fromEntries(GROUPS.flatMap(([, only, rows]) => rows.map(r => [r[0], only])));
  const RES = {fuel:'fuel', tyres:'tyres', compound:'compound', tyre_set:'tyre_set', p0:'fl', p1:'fr', p2:'rl', p3:'rr', brakes:'brakes', front_pad:'front_pad', rear_pad:'rear_pad', flip_suspension:'flip_suspension', flip_bodywork:'flip_bodywork'};
  // DEF is only the fallback while nothing is stored and the MFD is not live: a new page seeds the plan from the last plan sent,
  // or from the MFD (seed()), so it opens with no changes and Send cannot zero the driver's fuel.
  const DEF = {fuel:0, tyres:false, compound:'dry', tyre_set:1, pressures:[26.5, 26.5, 26.5, 26.5], brakes:false, front_pad:1, rear_pad:1, flip_suspension:false, flip_bodywork:false};
  const OK_RES = ['ok', 'sent', 'skipped', 'switched on for the pressures'];   // acc_pit results that are not failures
  const RES_TEXT = {'switched on for the pressures':['on', 'Tyre change switched on: ACC fits the pressures only with a tyre change']};
  const plan = () => { const p = Object.assign({}, DEF, lsGet('pitwall.plan', {}) || {}); if (!Array.isArray(p.pressures) || p.pressures.length !== 4) p.pressures = DEF.pressures.slice(); return p; };
  const pv = (p, k) => /^p\d$/.test(k) ? p.pressures[+k[1]] : p[k];
  const pstep = () => ({psi:0.1, bar:0.01, kpa:1}[Pit.prefs.units.press] || 0.1);
  const pin = psi => +un('press').f(psi).toFixed(un('press').d);   // psi → the input's unit
  const INSTS = new Set();
  function seed(c){   // no stored plan: the last plan sent from any screen, else the MFD as it is now. true when seeded.
    if (lsRaw('pitwall.plan') != null) return false;
    const job = c.pitJob, p = c.pit;
    let q = null;
    if (job && isObj(job.plan)) { q = Object.assign({}, DEF); for (const k of Object.keys(DEF)) if (job.plan[k] !== undefined) q[k] = job.plan[k]; }
    else if (p && p.status === 'live') q = Object.assign({}, DEF, {fuel:Math.round(p.fuel), tyre_set:p.tyre_set || 1, pressures:Array.isArray(p.pressures) ? p.pressures.map(v => +v.toFixed(1)) : DEF.pressures.slice()});
    if (!q) return false;
    if (!Array.isArray(q.pressures) || q.pressures.length !== 4 || !q.pressures.every(v => typeof v === 'number' && isFinite(v))) q.pressures = DEF.pressures.slice();
    lsSet('pitwall.plan', q); for (const i of INSTS) fill(i.body, q);
    return true;
  }
  // what the last job did to row k: null when it did not touch it; {v, txt, cls, title} otherwise
  function resOf(job, k, P){
    if (!job || job.state !== 'done' || !job.res) return null;
    const r = job.res[RES[k]]; if (r == null || r === 'skipped') return null;
    const jv = isObj(job.plan) ? pv(Object.assign({pressures:[]}, job.plan), k) : undefined, mine = jv === undefined || jv == null || same(k, jv, pv(P, k));
    if (!mine) return {r, txt:`sent ${show(k, jv)}${job.by ? ' by ' + job.by : ''}`, cls:'s-dim', title:'The last send typed a different value from this plan'};
    const t = RES_TEXT[r];
    return {r, txt:t ? t[0] : r === 'ok' ? '✓ verified' : r === 'sent' ? 'sent' : '✗ ' + r, cls:r === 'ok' ? 's-ok' : OK_RES.includes(r) ? '' : 's-bad', title:t ? t[1] : ''};
  }

  // MFD now: only what ACC publishes. Values in display form, or null = not published.
  const nowOf = (pit, k) => {
    if (!pit || pit.status !== 'live') return undefined;
    if (k === 'fuel') return pit.fuel; if (k === 'tyre_set') return pit.tyre_set;
    if (/^p\d$/.test(k)) return pit.pressures ? pit.pressures[+k[1]] : null;
    return null;
  };
  // a field ACC does not publish: the value the last finished send typed into it (undefined when no send touched it), so a
  // switch that was sent and not changed since is no change
  const sentVal = (job, k) => {
    if (!job || job.state !== 'done' || !isObj(job.plan) || !job.res) return undefined;
    const r = job.res[RES[k]]; if (r == null || r === 'skipped' || !OK_RES.includes(r)) return undefined;
    return pv(Object.assign({pressures:[]}, job.plan), k);
  };
  const show = (k, v) => v == null ? '—' : typeof v === 'boolean' ? (v ? 'yes' : 'no') : /^p\d$/.test(k) ? fv('press', v) : k === 'fuel' ? Math.round(v) : String(v);
  const same = (k, a, b) => /^p\d$/.test(k) ? Math.abs(a - b) < 0.05 : k === 'fuel' ? Math.round(a) === Math.round(b) : a === b;
  function changes(p, pit, only, job){   // what this send would change, as text: "Fuel 42 → 58 L · FL 26.4 → 26.0 psi"
    const out = [];
    for (const [, g, rows] of GROUPS) {
      if (only && only !== g) continue;
      for (const [k] of rows) {
        const v = pv(p, k), n = nowOf(pit, k), u = /^p\d$/.test(k) ? ' ' + un('press').u : k === 'fuel' ? ' L' : '';
        if (n != null) { if (!same(k, n, v)) out.push(`${LABEL[k]} ${show(k, n)} → ${show(k, v)}${u}`); }
        else if ((v === true || ['compound', 'front_pad', 'rear_pad'].includes(k) && (only || p[k === 'compound' ? 'tyres' : 'brakes'])) && !(sentVal(job, k) !== undefined && same(k, sentVal(job, k), v))) out.push(`${LABEL[k]} → ${show(k, v)}`);
      }
    }
    return out;
  }
  function readPlan(el){
    const p = plan(); p.pressures = p.pressures.slice();
    for (const i of el.querySelectorAll('[data-f]')) {
      const k = i.dataset.f;
      if (/^p\d$/.test(k)) { const v = +i.value; if (isFinite(v) && i.value !== '') p.pressures[+k[1]] = +un('press').b(v).toFixed(2); continue; }
      p[k] = i.type === 'checkbox' ? i.checked : k === 'compound' ? i.value : +i.value;
    }
    return p;
  }
  function fill(el, p){
    for (const i of el.querySelectorAll('[data-f]')) {
      const k = i.dataset.f, v = pv(p, k); if (v == null || document.activeElement === i) continue;
      if (i.type === 'checkbox') i.checked = !!v; else i.value = /^p\d$/.test(k) ? pin(v) : v;
    }
  }
  const stepper = (l, input) => `<span class="stp"><button type="button" class="step" data-step="-1" aria-label="Decrease ${l}">−</button>${input}<button type="button" class="step" data-step="1" aria-label="Increase ${l}">+</button></span>`;
  const rowHtml = ([k, l, t, a, b, c, u]) => {
    const input = t === 'check' ? `<input type="checkbox" data-f="${k}" aria-label="${l}">`
      : t === 'select' ? `<select data-f="${k}" aria-label="${l}">${a.map(([v, n]) => `<option value="${v}">${n}</option>`).join('')}</select>`
      : t === 'press' ? `${stepper(l, `<input type="number" data-f="${k}" step="${pstep()}" aria-label="Pressure ${l}">`)}<span class="u"> ${un('press').u}</span>`
      : stepper(l, `<input type="number" data-f="${k}" min="${a}" max="${b}" step="${c}" aria-label="${l}">`) + (u ? `<span class="u"> ${u}</span>` : '');
    return `<div class="pr" data-row="${k}"><span class="pr-l">${l}</span><span class="pp-in">${input}</span>
      <span class="pr-meta"><span class="pr-now" title="${/^p\d$|^(fuel|tyre_set)$/.test(k) ? 'In the MFD now' : 'ACC does not publish this field'}">MFD <span data-now="${k}">—</span></span><span class="pr-chg" data-chg="${k}"></span><span class="pr-res" data-r="${RES[k]}"></span></span></div>`;
  };
  async function send(inst, only, confirmed){
    const el = inst.body, p = readPlan(el), st = inst.state, c = Pit.ctx;
    lsSet('pitwall.plan', p);
    if (st.confirm && !confirmed) {
      const ch = changes(p, c && c.pit, only, c && c.pitJob), box = el.querySelector('.pp-confirm');
      box.querySelector('p').textContent = (only ? `Send ${only}: ` : 'Send the whole plan: ') + (ch.length ? ch.join(' · ') : 'nothing differs from the MFD');
      box.hidden = false; st.pending = only || ''; box.querySelector('[data-go]').focus(); return;
    }
    el.querySelector('.pp-confirm').hidden = true;
    st.msg = only ? `Sending ${only}…` : 'Sending the whole plan…'; Pit.dirty('pit');
    const r = await Pit.post('/pit', only ? Object.assign({}, p, {only:[only]}) : p);
    if (r.status === 202 && (!only || only === 'repairs')) {   // a repair switch is one-shot: off again once sent
      p.flip_suspension = p.flip_bodywork = false; lsSet('pitwall.plan', p); for (const i of INSTS) fill(i.body, p);
    }
    st.msg = r.status === 0 ? r.text : r.status === 202 ? "Sent. Typing it into the driver's pit page; keep ACC focused on the driver's PC."
      : r.status === 403 ? 'Wrong or missing access key: Settings › Connection.' : r.status === 409 ? 'Busy (409): a plan is still being typed.' : 'Refused: ' + r.text;
    st.flash = new Set(); Pit.dirty('pit');
  }
  Pit.on('pitjob', j => { if (j && j.state !== 'running') for (const i of INSTS) i.state.msg = ''; });   // the job's own outcome replaces "Sent…"
  Pit.on('plan', patch => {   // from race-plan ("Put in pit plan") and press-fix ("Use in pit plan")
    if (!isObj(patch)) return;
    const p = Object.assign(plan(), patch), keys = Object.keys(patch).flatMap(k => k === 'pressures' ? ['p0', 'p1', 'p2', 'p3'] : [k]);
    lsSet('pitwall.plan', p);
    for (const i of INSTS) { i.state.flash = new Set(keys); i.state.msg = ''; fill(i.body, p); }
    Pit.dirty('pit');
  });

  Pit.module({type:'pit-plan', title:'Pit stop', group:'Pit', blurb:"The next stop, typed into the driver's MFD: the whole plan or one block.",
    size:{w:7, h:22, minW:6, minH:12}, multi:false, needs:['pit', 'reading', 'config', 'units'], requires:['pit'], rate:4,
    options:[{key:'confirm', label:'Confirm before sending', type:'toggle', def:true}],
    build(el, inst){
      INSTS.add(inst); inst.state.confirm = inst.opts.confirm; inst.state.flash = new Set();
<<<<<<< HEAD
      el.innerHTML = `<div class="pp">
        <header class="pp-head"><div class="pp-hl"><p class="pp-state" data-state role="status">Draft</p><dl class="kv pp-sets"></dl></div>
          <div class="pp-acts"><button type="button" class="btn" data-copy>Copy MFD into plan</button><button type="button" class="btn" data-close title="Takes the pit page off the driver's screen (ACC's Cycle MFD: Insert, or vJoy button 6)">Close pit page</button>
            <button type="button" class="btn primary" data-whole>Send whole plan</button></div></header>
        <div class="pp-confirm" hidden><p></p><div class="pp-acts"><button type="button" class="btn primary" data-go>Send</button><button type="button" class="btn" data-cancel>Cancel</button></div></div>
        <div class="pp-cards">${GROUPS.map(([g, only, rows]) =>
          `<section class="pc pc-${only}"><h3><span>${g}</span><button type="button" class="btn send" data-only="${only}">Send</button></h3><div class="pc-rows">${rows.map(rowHtml).join('')}</div></section>`).join('')}</div>
        <footer class="pp-foot"><label class="check"><input type="checkbox" data-confirm${inst.state.confirm ? ' checked' : ''}> Confirm before sending</label>
          <p class="note">Each block sends on its own; only what is sent is touched on the driver's pit page. Fuel, tyre set and pressures are read back from the game. “MFD —” means ACC does not publish that field: it is typed in, but cannot be verified.</p></footer></div>`;
=======
      el.innerHTML = `<div class="split pp"><table class="tt pp-t"><thead><tr><th class="pp-ci">Item</th><th class="n pp-cn">MFD now</th><th class="pp-cp">Plan</th><th class="n pp-cc">Change</th><th class="pp-cr">Result</th></tr></thead><tbody>${GROUPS.map(([g, only, rows]) =>
        `<tr class="tt-group"><td colspan="5">${g}<button type="button" class="btn send" data-only="${only}">Send ${g.toLowerCase()}</button></td></tr>${rows.map(rowHtml).join('')}`).join('')}</tbody>
        <caption class="note pp-np">— in MFD now: ACC does not publish that field. It is typed in when sent, but cannot be read back.</caption></table>
        <div class="split-v pp-side"><p class="pp-state" data-state role="status">Draft</p><dl class="kv pp-sets"></dl>
          <div class="pp-confirm" hidden><p></p><div class="pp-acts"><button type="button" class="btn primary" data-go>Send</button><button type="button" class="btn" data-cancel>Cancel</button></div></div>
          <button type="button" class="btn primary" data-whole>Send whole plan</button><button type="button" class="btn" data-copy>Copy MFD into plan</button><button type="button" class="btn" data-close title="Takes the pit page off the driver's screen (ACC's Cycle MFD: Insert, or vJoy button 6)">Close pit page</button>
          <label class="check"><input type="checkbox" data-confirm${inst.state.confirm ? ' checked' : ''}> Confirm before sending</label>
          <p class="note">Send one block, or the whole plan. Only what is sent is touched on the driver's pit page, typed in with ACC's own MFD controls. Fuel, tyre set and pressures are read back from the game.</p></div></div>`;
>>>>>>> d6540988f55db45447805d7903fa330f67cd83ce
      fill(el, plan());
      el.addEventListener('change', e => {
        const t = e.target;
        if (t.matches('[data-confirm]')) { inst.state.confirm = t.checked; return; }
        if (t.dataset.f === 'compound') {   // a compound change resets the pressures to the middle of that compound's window
          const T = th(Pit.ctx), [lo, hi] = t.value === 'wet' ? T.wet_psi : T.dry_psi, mid = +((lo + hi) / 2).toFixed(1);
          const p = readPlan(el); p.pressures = [mid, mid, mid, mid]; lsSet('pitwall.plan', p); fill(el, p);
          inst.state.flash = new Set(['p0', 'p1', 'p2', 'p3']);
        } else if (t.dataset.f) { lsSet('pitwall.plan', readPlan(el)); inst.state.flash = new Set(); }
        inst.state.msg = ''; Pit.dirty('pit');
      });
      el.addEventListener('click', e => {
        const b = e.target.closest('button'); if (!b || b.disabled) return;
        if (b.dataset.step) {   // − / +: the input's own step, clamped to its min and max
          const i = b.parentNode.querySelector('input'); b.dataset.step < 0 ? i.stepDown() : i.stepUp(); i.dispatchEvent(new Event('change', {bubbles:true})); return;
        }
        if (b.hasAttribute('data-cancel')) { el.querySelector('.pp-confirm').hidden = true; return; }
        if (b.hasAttribute('data-go')) return send(inst, inst.state.pending || undefined, true);
        if (b.hasAttribute('data-copy')) {
          const p = Pit.ctx.pit; if (!p || p.status !== 'live') return;
          const q = readPlan(el); q.fuel = Math.round(p.fuel); q.tyre_set = p.tyre_set || 1; q.pressures = p.pressures.map(v => +v.toFixed(1));
          lsSet('pitwall.plan', q); fill(el, q); inst.state.flash = new Set(); inst.state.msg = 'MFD copied into the plan.'; Pit.dirty('pit'); return;
        }
        if (b.hasAttribute('data-whole')) return send(inst);
        if (b.hasAttribute('data-close')) {
          inst.state.msg = 'Closing the pit page…'; Pit.dirty('pit');
          return Pit.post('/mfd/close', {}).then(r => { inst.state.msg = r.status === 202 ? "Closing the pit page on the driver's screen; the log says when it is done."
            : r.status === 409 ? 'Busy (409): a plan is still being typed.' : r.status === 403 ? 'Wrong or missing access key: Settings › Connection.' : 'Refused: ' + r.text; Pit.dirty('pit'); });
        }
        if (b.dataset.only) return send(inst, b.dataset.only);
      });
    },
    destroy(inst){ INSTS.delete(inst); },
    render(c, inst){
      seed(c);
      const p = c.pit, job = c.pitJob, live = p && p.status === 'live', busy = job && job.state === 'running', el = inst.body, st = inst.state, P = readPlan(el);
<<<<<<< HEAD
      if (st.unit !== Pit.prefs.units.press) { st.unit = Pit.prefs.units.press; for (const i of el.querySelectorAll('[data-f^="p"]')) i.step = pstep(); for (const u of el.querySelectorAll('.pp-in .u')) if (u.parentNode.querySelector('[data-f]').dataset.f[0] === 'p') u.textContent = ' ' + un('press').u; fill(el, plan()); }
      el.querySelectorAll('[data-only],[data-whole],[data-go]').forEach(b => { b.disabled = !live || busy || !Pit.key; b.title = !Pit.key ? 'Needs the access key: Settings › Connection' : !live ? 'ACC is not live on the driver\'s PC' : busy ? 'A plan is still being typed' : ''; });
=======
      el.firstChild.classList.toggle('pp-narrow', el.clientWidth > 0 && el.clientWidth < 600);
      if (st.unit !== Pit.prefs.units.press) { st.unit = Pit.prefs.units.press; for (const i of el.querySelectorAll('[data-f^="p"]')) i.step = pstep(); for (const u of el.querySelectorAll('.pp-in .u')) if (u.previousSibling.dataset.f[0] === 'p') u.textContent = ' ' + un('press').u; fill(el, plan()); }
      el.querySelectorAll('[data-only],[data-whole],[data-go],[data-close]').forEach(b => { b.disabled = !live || busy || !Pit.key; b.title = !Pit.key ? 'Needs the access key: Settings › Connection' : !live ? 'ACC is not live on the driver\'s PC' : busy ? 'A plan is still being typed' : ''; });
>>>>>>> d6540988f55db45447805d7903fa330f67cd83ce
      el.querySelector('[data-copy]').disabled = !live;
      let n = 0;
      for (const td of el.querySelectorAll('[data-now]')) {
        const k = td.dataset.now, v = nowOf(p, k), chg = el.querySelector(`[data-chg="${k}"]`), pl = pv(P, k), u = k === 'fuel' ? ' L' : '';
<<<<<<< HEAD
        td.textContent = v == null ? '—' : show(k, v) + u; td.classList.toggle('s-dim', v == null);
=======
        td.textContent = v == null ? '—' : show(k, v) + u; td.classList.toggle('s-dim', v == null); td.title = v === null ? 'ACC does not publish this field' : '';
>>>>>>> d6540988f55db45447805d7903fa330f67cd83ce
        const diff = v != null && pl != null && !same(k, v, pl);
        const matters = typeof pl === 'boolean' ? pl : GROUP_OF[k] === 'tyres' ? P.tyres : GROUP_OF[k] === 'brakes' ? P.brakes : true;   // pads only matter with a brake change
        const sv = v === null ? sentVal(job, k) : undefined, sent = sv !== undefined && pl != null && same(k, sv, pl);   // unpublished: as the last send typed it
        setHtml(chg, diff ? `<span class="diff"><s>${esc(show(k, v))}</s>→<b>${esc(show(k, pl))}</b>${u}</span>` : v === null && matters && !sent ? `<span class="s-dim">→ ${esc(show(k, pl))}</span>` : '');
        if (diff || (v === null && pl === true && !sent)) n++;   // a switch ACC does not publish counts as a change until a send typed it
        el.querySelector(`[data-row="${k}"]`).classList.toggle('pp-new', st.flash.has(k));
      }
      const res = job && job.state === 'done' ? job.res || {} : {};
<<<<<<< HEAD
      for (const td of el.querySelectorAll('[data-r]')) { const r = resOf(job, td.closest('[data-row]').dataset.row, P); td.textContent = r ? r.txt : ''; td.className = 'pr-res ' + (r ? r.cls : ''); td.title = r ? r.title : ''; }
=======
      el.firstChild.classList.toggle('pp-quiet', !n && !Object.keys(res).length);   // narrow: Change and Result only once there is something in them
      for (const td of el.querySelectorAll('[data-r]')) { const r = resOf(job, td.parentNode.dataset.row, P); td.textContent = r ? r.txt : ''; td.className = r ? r.cls : ''; td.title = r ? r.title : ''; }
>>>>>>> d6540988f55db45447805d7903fa330f67cd83ce
      const vals = Object.values(res), verified = vals.length && vals.every(v => OK_RES.includes(v)), when = job && job.t ? hms(new Date(job.t * 1000)) : '';
      el.querySelector('[data-state]').textContent = !p ? 'No pit control' : busy ? (p.waiting_lift ? 'Applying: waiting for the driver to lift' : 'Applying…')
        : st.msg ? st.msg : job && job.state === 'error' ? 'Failed: ' + job.msg : job && job.state === 'done' ? `Applied ${when}${job.by ? ' by ' + job.by : ''}${verified ? ' · verified' : ' · check the results'}${n ? ` · draft: ${n} change${n === 1 ? '' : 's'}` : ''}` : `Draft (${n} change${n === 1 ? '' : 's'})`;
      el.querySelector('[data-state]').className = 'pp-state' + (job && job.state === 'error' && !st.msg ? ' s-bad' : busy ? ' s-warn' : '');
      setHtml(el.querySelector('.pp-sets'), live ? kvHtml([['MFD current set', nf(p.current_set, 0)], ['MFD strategy set', nf(p.strategy_set, 0)]]) : '');
      inst.setInfo(live ? 'ACC live' + (p.in_pit_lane ? ' · in pit lane' : '') + (Pit.key ? '' : ' · no key') : p ? `ACC ${p.status}` : '');
    }});

  // ---------- pit sends log ----------
  Pit.module({type:'pit-log', title:'Pit sends', group:'Pit', blurb:'Every plan sent to the MFD: when, by whom, which blocks, and what came back.',
    size:{w:5, h:8, minW:4, minH:4}, needs:['pit'],
    build(el){ el.innerHTML = '<div class="pl"></div>'; },
    render(c, inst){
      const L = (c.pitLog || []).slice().reverse(); if (!L.length) return inst.setState('empty', 'No plans sent yet.');
      setHtml(inst.body.firstChild, L.map(e => {
        const r = e.res || {}, v = Object.values(r), ok = v.filter(x => x === 'ok').length, sent = v.filter(x => x === 'sent').length, bad = v.filter(x => !OK_RES.includes(x)).length;
        const sum = e.state === 'done' ? [ok && `<span class="s-ok">✓ ${ok} ok</span>`, sent && `sent ${sent}`, bad && `<span class="s-bad">✗ ${bad}</span>`].filter(Boolean).join(' · ') : `<span class="s-bad">✗ ${esc(e.msg || 'failed')}</span>`;
        return `<details class="pl-e"><summary><span class="n">${e.t ? hms(new Date(e.t * 1000)) : '—'}</span> <span>${esc(e.by || '?')}</span> <span class="note">${esc((e.only || []).join(', '))}</span> <span class="pl-r">${sum}</span></summary>
          <dl class="kv">${Object.entries(r).map(([k, x]) => `<dt>${esc(k)}</dt><dd class="${x === 'ok' ? 's-ok' : OK_RES.includes(x) ? 's-dim' : 's-bad'}">${esc(x)}</dd>`).join('') || '<dt>—</dt><dd></dd>'}</dl></details>`; }).join(''));
      inst.setInfo(`${L.length} send${L.length > 1 ? 's' : ''}`);
    }});

  // ---------- pressure correction ----------
  Pit.module({type:'press-fix', title:'Pressure correction', group:'Pit', blurb:'Hot pressures at the line against the window, and the cold pressures to set at the next stop.',
    size:{w:4, h:5, minW:3, minH:5}, needs:['summary', 'config', 'pit', 'units'],
    build(el){
      el.innerHTML = '<table class="tt pf"><thead><tr><th></th>' + CORNERS.map(x => `<th class="n">${x}</th>`).join('') + '</tr></thead><tbody></tbody></table><div class="pf-acts"><div class="sub pf-sub"></div><button type="button" class="btn" data-use>Use in pit plan</button></div>';
      el.querySelector('[data-use]').addEventListener('click', () => {
        const prop = el._prop; if (!prop) return;
        Pit.emit('plan', {pressures:prop}); Pit.log(0, 'PLAN', 'Pressure corrections put in the pit plan'); Pit.say('Pressure corrections put in the pit plan');
      });
    },
    render(c, inst){
      const pl = c.s && c.s.press_line; if (!pl || !Array.isArray(pl.psi)) return inst.setState('empty', 'Needs a green lap at the line.');
      const [lo, hi] = psiWindow(c), mid = (lo + hi) / 2, live = c.pit && c.pit.status === 'live' && Array.isArray(c.pit.pressures);
      const base = live ? c.pit.pressures : plan().pressures, corr = pl.psi.map(v => mid - v), prop = base.map((v, i) => +(v + corr[i]).toFixed(1));
      inst.body._prop = prop;
      const pu = v => fv('press', v), dp = d => { const x = un('press').f(d) - un('press').f(0); return Math.abs(d) < 0.05 ? '0' : `${d > 0 ? '▲ +' : '▼ ' + MINUS}${Math.abs(x).toFixed(un('press').d)}`; };
      setHtml(inst.body.querySelector('tbody'), [
        [`Avg at line <span class="note">${pl.laps} lap${pl.laps > 1 ? 's' : ''}</span>`, pl.psi.map(v => { const s = pressState(v, c); return `<span class="${s === 'ok' ? '' : 's-' + (s === 'bad' ? 'bad' : s === 'cold' ? 'cold' : 'warn')}">${pu(v)}${stateGlyph(s)}</span>`; })],
        ['Correction', corr.map(dp)],
        [`Cold to set <span class="note">${live ? 'MFD' : 'plan'} + corr.</span>`, prop.map(v => `<b>${pu(v)}</b>`)]]
        .map(([l, v]) => `<tr><td>${l}</td>${v.map(x => `<td class="n">${x}</td>`).join('')}</tr>`).join(''));
      const all = pl.psi.every(v => pressState(v, c) === 'ok'), d = pl.track_c_delta;
      setHtml(inst.body.querySelector('.pf-sub'), `<span>${all ? '<b class="s-ok">● In the window</b>' : `Window ${pu(lo)}–${pu(hi)} ${un('press').u}`}</span>${d != null && isFinite(d) && Math.abs(d) >= 0.5 ? `<span>Track ${d > 0 ? '+' : MINUS}${(Math.abs(d) * (un('temp').u === '°F' ? 1.8 : 1)).toFixed(1)}${un('temp').u} since stint start</span>` : ''}`);
      inst.setInfo(`window mid ${pu(mid)} ${un('press').u} · hot ≈ cold 1:1`);
      inst.setAlert(all ? 0 : 1);
    }});
})();
