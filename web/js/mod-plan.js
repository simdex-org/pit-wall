'use strict';
// mod-plan.js (D1): the race fuel and stint calculator. Unlike the live strategy figures (Telemetry.strategy in the bridge, from
// the car's state now), this plans a whole race from inputs the engineer types, so the maths is here and is a pure function:
// fuelPlan(inputs) -> options. tools/fuelplan_check.js runs it.

// Inputs (numbers, seconds and litres): raceMin | raceLaps, extra (laps after the timer), lapS, fpl (L/lap), cap (tank L),
// reserve (laps kept in the tank at every stop and the flag), formL (formation lap L), mand (mandatory stops), maxStintMin,
// lossS (drive-through), refuelSpl (s/L), tyreS, tyres (changed at every stop), seq (fuel then tyres, not together),
// minStat (s), wt (s per lap per 10 L carried).
// ponytail: laps are split evenly over the stints; a stop never changes the pace; the pit window is not planned
function fuelPlan(i){
  const timed = i.raceLaps == null, cap = i.cap > 0 ? i.cap : Infinity, res = i.reserve * i.fpl, out = {total:null, nMin:0, options:[], best:null, save:null};
  if (!(i.fpl > 0) || !(i.lapS > 0) || !((timed ? i.raceMin : i.raceLaps) > 0)) return out;
  const total = out.total = timed ? Math.ceil(i.raceMin * 60 / i.lapS - 1e-6) + (i.extra || 0) : Math.round(i.raceLaps);
  const nMin = out.nMin = Math.max(i.mand || 0, i.maxStintMin > 0 ? Math.ceil(total * i.lapS / (i.maxStintMin * 60) - 1e-6) - 1 : 0);
  const make = n => {
    const k = n + 1, base = Math.floor(total / k), rem = total % k, stints = [];
    let from = 1, stat = 0, wt = 0;
    for (let s = 0; s < k; s++) {
      const laps = base + (s < rem ? 1 : 0), burn = laps * i.fpl, load = burn + res + (s ? 0 : i.formL || 0);
      const a = s ? burn * i.refuelSpl : 0, b = s && i.tyres ? i.tyreS : 0, st = s ? Math.max(i.minStat || 0, i.seq ? a + b : Math.max(a, b)) : 0;
      stints.push({n:s + 1, laps, from, to:from + laps - 1, load, add:s ? burn : null, stat:st});
      stat += st; wt += laps * (i.wt || 0) / 10 * (load - burn / 2); from += laps;
    }
    const tank = stints.every(s => s.load <= cap + 1e-9);
    return {n, stints, start:stints[0].load, stat, tank, rule:n >= nMin, ok:tank && n >= nMin, timeS:total * i.lapS + n * i.lossS + stat + wt};
  };
  const all = [];
  for (let n = 0; n <= 9; n++) all.push(make(n));
  const first = all.findIndex(o => o.ok);
  if (first < 0) { out.options = all.slice(Math.max(0, Math.min(nMin, 9) - 1), Math.min(nMin, 9) + 3); return out; }
  out.options = all.slice(Math.max(0, first - 1), first + 3);
  const ok = all.filter(o => o.ok);
  out.best = ok.reduce((a, b) => b.timeS < a.timeS ? b : a);
  const n = out.best.n;   // the consumption that saves a stop: the heaviest stint of n-1 stops must fit the tank
  if (n > 0 && n - 1 >= nMin && cap < Infinity) {
    const fmax = (cap - (i.formL || 0)) / (Math.ceil(total / n) + i.reserve);
    out.save = {fpl:fmax, pct:(1 - fmax / i.fpl) * 100, gainS:out.best.timeS - all[n - 1].timeS};
  }
  return out;
}

(() => {
  const NUMS = ['race', 'extra', 'fpl', 'cap', 'reserve', 'formL', 'mand', 'maxStint', 'loss', 'refuel', 'tyreS', 'minStat', 'wt'];
  const DEF = {unit:'min', lap:'', tyres:true};
  const load = () => { const o = lsGet('pitwall.calc', {}), d = {...DEF}; if (o && typeof o === 'object') { for (const k of NUMS) if (typeof o[k] === 'string' && o[k].length < 12 && /^[0-9.,:]*$/.test(o[k])) d[k] = o[k];
    if (o.unit === 'laps') d.unit = 'laps'; if (typeof o.lap === 'string' && /^[0-9.:]{0,10}$/.test(o.lap)) d.lap = o.lap; if (typeof o.tyres === 'boolean') d.tyres = o.tyres; if (typeof o.seq === 'boolean') d.seq = o.seq; } return d; };
  const num = s => { const v = parseFloat(String(s == null ? '' : s).replace(',', '.')); return isFinite(v) ? v : null; };
  const lapSecs = s => { const m = /^(?:(\d+):)?(\d+(?:[.,]\d+)?)$/.exec(String(s).trim()); return m ? (m[1] ? +m[1] * 60 : 0) + parseFloat(m[2].replace(',', '.')) : null; };
  const hms = s => { s = Math.round(s); return `${Math.floor(s / 3600)}:${String(Math.floor(s % 3600 / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
  const L_ = v => `${nf(v, 1)}<span class="u"> L</span>`;
  const sgn = (v, d) => (v < 0 ? MINUS : '+') + nf(Math.abs(v), d);
  // [key, label, unit, step]: what each field means is in its title; an empty field uses the live figure shown as its placeholder
  const F = {
    race:['Race length', '', 1], extra:['Extra laps', 'laps', 1], fpl:['Fuel per lap', 'L', .01], cap:['Tank', 'L', 1], reserve:['Reserve', 'laps', .1],
    formL:['Formation', 'L', .5], mand:['Mandatory stops', '', 1], maxStint:['Max driver stint', 'min', 1], loss:['Pit loss', 's', .5],
    refuel:['Refuelling', 's/L', .01], tyreS:['Tyres', 's', 1], minStat:['Min. stationary', 's', 1], wt:['Weight / 10 L', 's/lap', .01]};
  const TIPS = {extra:'Laps driven after the timer reaches zero, on top of finishing the lap in progress (already counted).',
    reserve:'Laps of fuel left in the tank at the flag, and when you arrive at each stop.', formL:'Fuel burnt before lap 1 (formation lap, grid).',
    maxStint:'Longest time one driver may drive in a row: forces stops. Empty = no limit.', wt:'How much slower a lap is per 10 L of fuel carried (average over the lap). 0 = ignore; a stop then costs only its time.',
    race:'Empty fields use the live value shown in grey.'};

  Pit.module({type:'fuel-calc', title:'Fuel & stints', group:'Strategy', blurb:'Plan the race: fuel to start with, stops, stint lengths and the fuel at each stop, from race length, lap time and consumption.',
    size:{w:6, h:20, minW:4, minH:10}, needs:['summary', 'reading', 'config'], rate:2,
    build(el, inst){
      const f = k => `<label class="fc-f" title="${esc(TIPS[k] || '')}"><span>${F[k][0]}</span><span class="fc-in"><input type="text" inputmode="decimal" data-k="${k}" autocomplete="off">${F[k][1] ? `<i>${F[k][1]}</i>` : ''}</span></label>`;
      el.innerHTML = `<div class="fc-form">
          <label class="fc-f"><span>Race length</span><span class="fc-in"><input type="text" inputmode="decimal" data-k="race"><select data-k="unit"><option value="min">min</option><option value="laps">laps</option></select></span></label>
          <label class="fc-f"><span>Lap time</span><span class="fc-in"><input type="text" data-k="lap"></span></label>
          ${f('fpl')}${f('cap')}${f('reserve')}${f('extra')}${f('formL')}
          ${f('mand')}${f('maxStint')}${f('loss')}${f('refuel')}${f('tyreS')}${f('minStat')}${f('wt')}
          <label class="fc-c"><input type="checkbox" data-k="tyres"> Tyres at every stop</label>
          <label class="fc-c"><input type="checkbox" data-k="seq"> Fuel, then tyres</label></div>
        <div class="rp-acts"><button type="button" class="btn" data-plan>Put start fuel in pit plan</button><button type="button" class="btn" data-clear>Clear inputs</button></div>
        <div class="fc-res"></div>`;
      const s = inst.state; s.v = load(); s.sel = null;
      for (const i of el.querySelectorAll('[data-k]')) { const k = i.dataset.k; if (i.type === 'checkbox') i.checked = !!s.v[k]; else if (s.v[k] != null) i.value = s.v[k]; }
      const save = () => { lsSet('pitwall.calc', s.v); s.upd(); };
      el.addEventListener('input', e => { const i = e.target.closest('[data-k]'); if (!i) return; s.v[i.dataset.k] = i.type === 'checkbox' ? i.checked : i.value.trim(); s.sel = null; save(); });
      el.addEventListener('click', e => {
        const tr = e.target.closest('[data-n]');
        if (tr) { s.sel = +tr.dataset.n; s.upd(); return; }
        if (e.target.closest('[data-clear]')) { s.v = {...DEF}; s.sel = null; for (const i of el.querySelectorAll('[data-k]')) { if (i.type === 'checkbox') i.checked = i.dataset.k === 'tyres'; else i.value = DEF[i.dataset.k] || ''; } save(); return; }
        if (e.target.closest('[data-plan]') && s.start != null) { const n = Math.ceil(s.start); Pit.emit('plan', {fuel:n}); Pit.say(`Start fuel ${n} L put in the pit plan`); }
      });
    },
    render(c, inst){
      const s = inst.state, b = inst.body, st = c.st, cfg = c.cfg && c.cfg.strategy || {}, fx = c.r && c.r.fixed;
      // live figures: the inputs' placeholders and the fallback of every empty field
      const live = {fpl:st && st.fuel_per_lap > 0 ? st.fuel_per_lap : c.r && c.r.session.fuel_per_lap > 0 ? c.r.session.fuel_per_lap : null,
        lap:st && (st.my_pace_ms || st.lap_ref_ms) ? (st.my_pace_ms || st.lap_ref_ms) / 1000 : null, cap:fx && fx.max_fuel > 0 ? fx.max_fuel : null,
        reserve:cfg.reserve_laps, mand:cfg.mandatory_stops, loss:st ? st.drive_loss_s : cfg.pit_loss_s, refuel:st ? st.refuel_s_per_l : cfg.refuel_s_per_l, tyreS:st ? st.tyre_s : cfg.tyre_s, minStat:cfg.min_stationary_s};
      const ph = {race:'', extra:'0', formL:'0', maxStint:'none', wt:'0', lap:live.lap != null ? fmtLap(live.lap * 1000) : 'm:ss.xxx'};
      for (const k of ['fpl', 'cap', 'reserve', 'mand', 'loss', 'refuel', 'tyreS', 'minStat']) ph[k] = live[k] == null ? '' : String(+(+live[k]).toFixed(2));
      for (const i of b.querySelectorAll('[data-k]')) if (i.type === 'text') i.placeholder = ph[i.dataset.k] || '';
      const sq = b.querySelector('[data-k="seq"]'); if (s.v.seq == null) sq.checked = cfg.fuel_and_tyres === 'sequential';   // until chosen by hand, the shared setting
      s.upd = () => {
        const v = s.v, n = k => num(v[k]), or = (k, d) => n(k) != null ? n(k) : live[k] != null ? +live[k] : d, laps = v.unit === 'laps';
        const inp = {raceMin:laps ? null : n('race'), raceLaps:laps ? n('race') : null, extra:n('extra') || 0, lapS:v.lap ? lapSecs(v.lap) : live.lap, fpl:or('fpl'), cap:or('cap'),
          reserve:or('reserve', 1), formL:n('formL') || 0, mand:Math.round(or('mand', 0)), maxStintMin:n('maxStint'), lossS:or('loss', 25), refuelSpl:or('refuel', .25), tyreS:or('tyreS', 30),
          tyres:v.tyres !== false, seq:v.seq != null ? v.seq : cfg.fuel_and_tyres === 'sequential', minStat:or('minStat', 0), wt:n('wt') || 0};
        const res = b.querySelector('.fc-res'), p = fuelPlan(inp);
        s.start = null;
        if (!p.total) {
          const miss = [!((laps ? inp.raceLaps : inp.raceMin) > 0) && 'the race length', !(inp.lapS > 0) && 'a lap time', !(inp.fpl > 0) && 'the fuel per lap'].filter(Boolean);
          setHtml(res, `<p class="note fc-miss">Still needed: ${miss.join(', ')}. Grey figures are live values; an empty field uses them.</p>`); inst.setInfo(''); return; }
        const pick = p.options.find(o => o.n === s.sel) || p.best || p.options[0], sel = pick;
        s.start = sel.ok ? sel.start : null;
        let h = '';
        if (!p.best) h += `<p class="s-bad">■ No plan fits: the tank (${inp.cap < Infinity ? nf(inp.cap, 0) + ' L' : '—'}) cannot carry a stint of ${plural(Math.ceil(p.total / 10), 'lap')} or more. Check the fuel per lap and the tank.</p>`;
        h += `<div class="lbl">Start with</div><div class="big">${nf(Math.ceil(sel.start), 0)}<span class="u"> L</span>${sel.tank ? '' : ' <b class="tag low">TANK</b>'}</div>
          <div class="sub"><span><b>${sel.n}</b> ${sel.n === 1 ? 'stop' : 'stops'}${sel === p.best ? ' (fastest)' : ''}</span><span><b>${p.total}</b> laps</span><span>≈ <b>${hms(sel.timeS)}</b></span></div>`;
        if (p.nMin > 0) h += `<p class="note">Rules force at least ${plural(p.nMin, 'stop')}${inp.maxStintMin > 0 && Math.ceil(p.total * inp.lapS / (inp.maxStintMin * 60) - 1e-6) - 1 > (inp.mand || 0) ? ' (the driver stint limit)' : ''}.</p>`;
        // the stints on one bar: width = laps; the fuel loaded at the start of each in the label
        h += `<div class="fc-bar" role="img" aria-label="${sel.stints.length} stints">${sel.stints.map(t => `<div class="fc-seg" style="flex:${t.laps} 1 0" title="Stint ${t.n}: L${t.from}–${t.to}, ${nf(t.load, 0)} L loaded"><b>S${t.n}</b> ${t.laps} L<br><span>${nf(t.load, 0)} L</span></div>`).join('')}</div>`;
        h += `<table class="tt fc-st"><thead><tr><th>Stint</th><th class="n">Laps</th><th class="n">Tank at start</th><th class="n">Add at stop</th><th class="n">Stationary</th></tr></thead><tbody>${
          sel.stints.map(t => `<tr><td>S${t.n} <span class="note">L${t.from}–${t.to}</span></td><td class="n">${t.laps}</td><td class="n">${nf(t.load, 1)}</td><td class="n">${t.add == null ? '—' : nf(t.add, 1)}</td><td class="n">${t.add == null ? '—' : nf(t.stat, 1) + ' s'}</td></tr>`).join('')}</tbody></table>`;
        h += `<div class="lbl fc-h">Compare stop counts</div><table class="tt fc-op"><thead><tr><th>Stops</th><th class="n">Start fuel</th><th class="n">Longest stint</th><th class="n">Race time</th><th>Check</th></tr></thead><tbody>${
          p.options.map(o => `<tr data-n="${o.n}" class="${o === sel ? 'so-best' : ''}${o.ok ? '' : ' so-off'}"><td>${o === sel ? '▶ ' : ''}${o.n}</td><td class="n">${nf(o.start, 0)} L</td><td class="n">${Math.max(...o.stints.map(t => t.laps))} L</td>
            <td class="n">${hms(o.timeS)}${p.best && o.ok && o !== p.best ? ` <span class="note">${sgn(o.timeS - p.best.timeS, 0)} s</span>` : ''}</td><td>${o.ok ? (o === p.best ? '◆ fastest' : 'ok') : !o.tank ? '<span class="s-bad">■ over the tank</span>' : '<span class="s-warn">▲ below the rules</span>'}</td></tr>`).join('')}</tbody></table>`;
        // what-ifs: the same stop count at other consumptions, and the consumption that saves a stop
        const kv = [];
        if (p.save) kv.push(['To save a stop', `≤ ${nf(p.save.fpl, 2)}<span class="u"> L/lap</span> <span class="note">${MINUS}${nf(p.save.pct, 1)} % of ${nf(inp.fpl, 2)}, worth ≈ ${nf(p.save.gainS, 0)} s</span>`]);
        for (const m of [.95, 1.05, 1.1]) { const q = fuelPlan({...inp, fpl:inp.fpl * m}).options.find(o => o.n === sel.n);
          if (q) kv.push([`${m < 1 ? MINUS : '+'}${Math.round(Math.abs(1 - m) * 100)} % consumption`, q.tank ? `${L_(q.start)} to start` : '<span class="s-bad">■ no longer fits the tank</span>']); }
        h += `<div class="lbl fc-h">What if</div>${kvHtml(kv)}`;
        h += `<p class="note">Total fuel burnt ${nf(p.total * inp.fpl, 0)} L${inp.cap < Infinity ? '' : ' (no tank size known: set it above)'}. Each stop is the pit loss (${nf(inp.lossS, 0)} s) plus the refuel or tyre time.</p>`;
        setHtml(res, h);
        inst.setInfo(`${p.total} laps · ${sel.n} ${sel.n === 1 ? 'stop' : 'stops'}`);
      };
      s.upd();
    }});
})();
