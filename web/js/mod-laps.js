'use strict';
// mod-laps.js (D2): laps, debrief, lap-picker, traces, segments. Own laps come from the bridge list (ctx.laps); whole-lap
// traces from GET /lap (recorder.js ensureLap), so REF/CMP survive a reload. Lap ids: 'lap-<n>' for own laps, 'imp-<k>' for imports.
(() => {
  let themeVer = 0; Pit.on('theme', () => { themeVer++; });
  const lapName = l => l.src === 'import' ? `${l.label} L${l.n}` : `L${l.n}`;
  const hasTrace = (c, n) => c.laps.some(l => l.n === n && l.trace) || !!lapById('lap-' + n);
  const autoSel = {ref:true, cmp:true};   // the lap picker keeps choosing REF and CMP until the user picks one by hand
  function pick(which, id){
    const c = Pit.ctx; autoSel[which] = false; Pit.select(which, c.sel[which] === id ? null : id);
    const n = lapNo(id); if (n) ensureLap(n);
  }
  const selBtns = (c, id) => ['ref', 'cmp'].map(w => `<button type="button" class="btn sel-${w}" data-sel="${w}" data-id="${esc(id)}" aria-pressed="${c.sel[w] === id}" title="${w === 'ref' ? 'Reference lap (solid)' : 'Comparison lap (dashed)'}">${w.toUpperCase()}</button>`).join('');
  const selClick = el => el.addEventListener('click', e => { const b = e.target.closest('[data-sel]'); if (b) pick(b.dataset.sel, b.dataset.id); });

  // ---------- laps ----------
  Pit.module({type:'laps', title:'Laps', group:'Laps', blurb:'Every lap of the session by stint: times, sectors, fuel, position, marks; pick laps to compare.',
    size:{w:8, h:22, minW:5, minH:8}, linkable:true, needs:['laps', 'rec', 'sel', 'focus', 'summary'], rate:2,
    options:[{key:'who', label:'Whose laps', type:'select', choices:[['self', 'Mine'], ['focus', 'The focus car (when one is set)']], def:'self'},
      {key:'onlyStint', label:'This stint only', type:'toggle', def:false}],
    build(el, inst){
      el.innerHTML = '<table class="tt lp"><thead></thead><tbody></tbody><tfoot></tfoot></table>';
      inst.state.fold = new Set();
      selClick(el);
      el.addEventListener('click', e => { const f = e.target.closest('.fold[data-st]'); if (!f) return; const n = +f.dataset.st, s = inst.state.fold; s.has(n) ? s.delete(n) : s.add(n); Pit.dirty('laps'); });
    },
    render(c, inst){
      const st = inst.state, o = inst.opts, other = o.who === 'focus' && c.focus !== 'self' ? c.cars.get(c.focus) : null;
      if (other) {   // another car: its lap history from the bridge, fetched when its lap count changes
        const key = other.i + ':' + other.laps;
        if (st.fkey !== key && !st.loading) { st.loading = true; Pit.get('/field/laps?car=' + other.i).then(j => { st.flaps = j && Array.isArray(j.laps) ? j.laps : []; st.fcar = other.i; st.fkey = key; st.loading = false; Pit.dirty('laps'); }); }
        if (st.fcar !== other.i) return inst.setState('empty', `Loading #${other.num}'s laps from the bridge…`);
      }
      let L = other ? st.flaps : c.laps;
      if (!L.length) return inst.setState('empty', other ? 'No laps for that car yet.' : 'No completed laps yet.');
      const cs = Math.max(...L.map(l => l.stint || 1));
      if (o.onlyStint && !other) L = L.filter(l => (l.stint || 1) === cs);
      const ok = L.filter(l => l.valid && l.ms > 0), best = ok.length ? Math.min(...ok.map(l => l.ms)) : null;
      const sBest = [0, 1, 2].map(k => Math.min(...ok.map(l => (l.s || [])[k]).filter(v => v > 0), Infinity));
      // ◆ is the session best of the whole field (as in standings), never just this list's best, which is ● like any improvement
      const F = fieldOn(c) ? c.field : null, fb = F && F.best && F.best.ms > 0 ? F.best.ms : null, cars = F ? [...c.cars.values()] : [];
      const fS = [0, 1, 2].map(k => Math.min(...cars.map(x => (x.best_s || [])[k]).filter(v => v > 0), Infinity));
      // personal improvements: faster than every earlier valid lap (lap and each sector)
      const pb = new Map(); { let lb = Infinity, sb = [Infinity, Infinity, Infinity]; for (const l of L) { if (!l.valid) continue; pb.set(l.n, [l.ms < lb, ...[0, 1, 2].map(k => (l.s || [])[k] > 0 && l.s[k] < sb[k])]); lb = Math.min(lb, l.ms); for (const k of [0, 1, 2]) if ((l.s || [])[k] > 0) sb[k] = Math.min(sb[k], l.s[k]); } }
      const mark = (v, isSb, isPb, f) => !okMs(v) ? '—' : isSb ? `<span class="t-best">◆ ${f(v)}</span>` : isPb ? `<span class="t-pb">● ${f(v)}</span>` : f(v);
      const own = !other;
      setHtml(inst.body.querySelector('thead'), `<tr>${own ? '<th class="lp-sel"></th>' : ''}<th class="n">Lap</th><th class="n">Time</th><th class="n">Δ best</th><th class="n">S1</th><th class="n">S2</th><th class="n">S3</th>${own ? '<th class="n">Fuel L</th>' : ''}<th class="n">Pos</th><th class="n">Gap</th><th></th></tr>`);
      const ncol = own ? 11 : 9;
      const row = l => {
        const id = 'lap-' + l.n, p = pb.get(l.n) || [], inv = !l.valid, isB = !inv && l.ms === best, ref = own && c.sel.ref === id, cmp = own && c.sel.cmp === id;
        return `<tr class="${[ref && 'ref', cmp && 'cmp'].filter(Boolean).join(' ')}">${own ? `<td class="lp-sel">${hasTrace(c, l.n) ? selBtns(c, id) : ''}</td>` : ''}<td class="n">${l.n}</td>`
          + `<td class="n">${inv ? `<span class="t-inv">${fmtLap(l.ms)}</span>` : mark(l.ms, l.ms === fb, isB || p[0], fmtLap)}</td><td class="n">${isB || inv || best == null ? '' : fmtDelta(l.ms - best)}</td>`
          + [0, 1, 2].map(k => { const v = (l.s || [])[k]; return `<td class="n">${inv ? `<span class="s-dim">${fmtSector(v)}</span>` : mark(v, v <= fS[k], v === sBest[k] || p[k + 1], fmtSector)}</td>`; }).join('')
          + (own ? `<td class="n">${nf(l.fuel, 2)}</td>` : '') + `<td class="n">${l.pos ? 'P' + l.pos : '—'}</td><td class="n">${l.gap != null ? fmtGap(l.gap) : '—'}</td>`
          + `<td class="tags">${[l.out && '<b class="tag out">OUT</b>', l.in && '<b class="tag in">IN</b>', inv && '<b class="tag inv">INV</b>', ref && '<b class="tag ref">REF</b>', cmp && '<b class="tag cmp">CMP</b>'].filter(Boolean).join(' ')}</td></tr>`;
      };
      let html = '';
      if (own) {
        const stints = (c.s && c.s.stints) || [];
        for (const n of [...new Set(L.map(l => l.stint || 1))].sort((a, b) => b - a)) {
          const ls = L.filter(l => (l.stint || 1) === n), info = stints.find(t => t.n === n) || {}, folded = st.fold.has(n);
          const clean = ls.filter(l => l.valid && !l.out && !l.in), avg = clean.length ? clean.reduce((a, l) => a + l.ms, 0) / clean.length : null, fu = ls.filter(l => l.fuel > 0);
          html += `<tr class="tt-group"><td colspan="${ncol}"><button type="button" class="fold" data-st="${n}" aria-expanded="${!folded}" aria-label="Fold stint ${n}"></button>Stint ${n} · ${info.wet || (ls[0] && ls[0].wet) ? 'W' : 'D'} set ${nf(info.tyre_set != null ? info.tyre_set : ls[ls.length - 1].set, 0)} · ${plural(ls.length, 'lap')} · best ${fmtLap(info.best_ms != null ? info.best_ms : Math.min(...ls.filter(l => l.valid).map(l => l.ms), Infinity))} · avg clean ${fmtLap(avg)} · ${fu.length ? nf(fu.reduce((a, l) => a + l.fuel, 0) / fu.length, 2) : '—'} L/lap</td></tr>`;
          if (!folded) html += ls.slice().reverse().map(row).join('');
        }
      } else html = L.slice().reverse().map(row).join('');
      setHtml(inst.body.querySelector('tbody'), html);
      // ideal lap: the best sectors of the clean laps that have all three, against the best lap; when the best lap has no
      // sectors (joined mid-lap, or the game sent none) the ideal can be slower than it, and the footer says why
      const full = ok.filter(l => !l.out && !l.in && (l.s || []).length >= 3 && l.s.slice(0, 3).every(v => v > 0));
      const ideal = full.length ? [0, 1, 2].reduce((a, k) => a + Math.min(...full.map(l => l.s[k])), 0) : null, bl = ok.find(l => l.ms === best);
      const why = !ideal ? '' : bl && !full.includes(bl) ? ` · best lap L${bl.n} had no sectors` : best != null ? ` · ${fmtDelta(ideal - best)} vs best` : '';
      setHtml(inst.body.querySelector('tfoot'), ideal ? `<tr><td colspan="${ncol}">Ideal ${fmtLap(ideal)} <span class="note">(Σ best sectors, ${plural(full.length, 'lap')})${why}</span></td></tr>` : '');
      const bm = best == null ? '' : best === fb ? ' · ◆ ' + fmtLap(best) : ' · ● ' + fmtLap(best);
      inst.setInfo(other ? `#${other.num} ${Pit.carName(other, 'short')} · ${plural(L.length, 'lap')}${bm}` : `${o.who === 'focus' ? 'yours · click a car to see theirs · ' : ''}${plural(L.length, 'lap')}${bm}`);
    }});

  // ---------- debrief ----------
  Pit.module({type:'debrief', title:'Debrief', group:'Laps', blurb:"The engineer's notes on the last laps.", size:{w:4, h:12, minW:3, minH:6},
    needs:['summary'], build(){}, render(c, inst){ const h = debriefHtml(c.s && c.s.debrief); if (inst.body._h !== h) { setHtml(inst.body, h); refreshIcons(inst.body); } }});

  // ---------- lap picker ----------
  Pit.module({type:'lap-picker', title:'Lap picker', group:'Analysis', blurb:'Every lap with a trace (bridge, this page, imported): pick REF and CMP.',
    size:{w:3, h:22, minW:3, minH:8}, multi:false, needs:['rec', 'laps', 'sel'],
    build(el, inst){
      el.innerHTML = '<table class="tt lk"><tbody></tbody></table><div class="lk-foot"><button type="button" class="btn" data-exp>Export laps</button><label class="btn">Import laps<input type="file" accept=".json,application/json" hidden></label><button type="button" class="btn" data-clr>Clear CMP</button></div><p class="note" role="status"></p>';
      selClick(el);
      el.querySelector('[data-exp]').addEventListener('click', exportLaps);
      el.querySelector('[data-clr]').addEventListener('click', () => { autoSel.cmp = false; Pit.select('cmp', null); });
      el.querySelector('input[type=file]').addEventListener('change', async e => { const f = e.target.files[0]; if (!f) return; el.querySelector('.note').textContent = await importLaps(f); e.target.value = ''; });
    },
    render(c, inst){
      const have = new Map(REC.laps.filter(l => l.data).map(l => [l.id, l]));
      for (const l of c.laps) if (l.trace && !have.has('lap-' + l.n)) have.set('lap-' + l.n, {id:'lap-' + l.n, n:l.n, ms:l.ms, valid:l.valid, src:'bridge', label:'', data:null});
      const rows = [...have.values()].sort((a, b) => (a.src === 'import') - (b.src === 'import') || (a.src === 'import' ? b.id.localeCompare(a.id, undefined, {numeric:true}) : b.n - a.n));
      if (!rows.length) return inst.setState('empty', 'Laps with traces appear here after the first whole lap. You can also import a laps file.', {label:'Import laps…', fn:() => inst.body.querySelector('input[type=file]').click()});
      // until the user picks one by hand, REF follows the best valid lap and CMP the newest other valid lap ("last vs best"),
      // re-chosen as laps complete; a click on REF or CMP anywhere (or Clear CMP) stops that slot following
      const own = rows.filter(l => l.src !== 'import'), set = (w, l) => { if (c.sel[w] === l.id) return; Pit.select(w, l.id); const n = lapNo(l.id); if (n) ensureLap(n); };
      if (autoSel.ref && rows.length) { const ok = own.filter(l => l.valid); set('ref', ok.length ? ok.reduce((a, x) => x.ms < a.ms ? x : a) : rows[0]); }
      if (autoSel.cmp) { const n = own.find(l => l.id !== c.sel.ref && l.valid) || own.find(l => l.id !== c.sel.ref); if (n) set('cmp', n); }
      setHtml(inst.body.querySelector('tbody'), rows.map(l => { const r = c.sel.ref === l.id, m = c.sel.cmp === l.id;
        return `<tr class="${[r && 'ref', m && 'cmp'].filter(Boolean).join(' ')}"><td class="lp-sel">${selBtns(c, l.id)}</td><td class="lk-n" title="${esc(lapName(l))}">${esc(lapName(l))}</td><td class="n">${l.valid ? fmtLap(l.ms) : `<span class="t-inv">${fmtLap(l.ms)}</span>`}</td><td class="tags">${l.valid ? '' : '<b class="tag inv">INV</b>'}${m && autoSel.cmp ? '<b class="tag s-dim" title="Follows the newest lap until you pick one">auto</b>' : ''}${!l.data ? (REC.pending.has(l.n) ? '<span class="note">loading</span>' : '') : ''}</td></tr>`; }).join(''));
      inst.setInfo(plural(rows.length, 'lap'));
    }});

  // ---------- traces ----------
  const LANE_CHOICES = [['delta', 'Δ time'], ['speed', 'Speed'], ['pedals', 'Throttle & brake'], ['steer', 'Steering'], ['gear', 'Gear'], ['rpm', 'RPM']];
  function selState(c, inst){   // the REF/CMP laps, or an empty/loading state set on inst; returns null when not drawable
    const ref = lapById(c.sel.ref), cmp = lapById(c.sel.cmp);
    if (!c.sel.ref && !c.sel.cmp) { inst.setState('empty', 'Pick a reference and a comparison lap in the lap picker or the Laps table.'); return null; }
    for (const id of [c.sel.ref, c.sel.cmp]) {
      if (!id || lapById(id)) continue;
      const n = lapNo(id); inst.setState('empty', REC.failed.has(n) ? `Lap ${n} has no trace on the bridge any more.` : `Loading lap ${n} from the bridge…`); return null;
    }
    if (!ref) { inst.setState('empty', 'Pick a reference lap (REF).'); return null; }
    return {ref, cmp};
  }
  Pit.module({type:'traces', title:'Traces', group:'Analysis', blurb:'REF against CMP over the lap distance: Δ time, speed, pedals, steering, gear.',
    size:{w:6, h:22, minW:4, minH:10}, needs:['rec', 'sel', 'reading'], rate:60,
    options:[{key:'lanes', label:'Lanes', type:'multi', choices:LANE_CHOICES, def:['delta', 'speed', 'pedals', 'steer', 'gear']}],
    build(el){
      el.innerHTML = '<div class="tr-lg"><span class="lg"><i class="sw" style="--c:var(--c-ref)"></i>REF solid</span><span class="lg"><i class="sw dash" style="--c:var(--c-cmp)"></i>CMP dashed</span></div><div class="cv"><canvas aria-label="Lap comparison traces"></canvas></div>';
      const cv = el.querySelector('canvas');
      cv.addEventListener('pointermove', e => { const b = cv.getBoundingClientRect(); Pit.setCursor((e.clientX - b.left) / b.width); });
      cv.addEventListener('pointerleave', () => Pit.setCursor(null));
    },
    render(c, inst){
      const s = selState(c, inst); if (!s) return;
      const lanes = inst.opts.lanes.filter(k => LANES[k]); if (!lanes.length) return inst.setState('empty', 'No lanes chosen: pick some in the options.');
      const k = JSON.stringify([c.sel, REC.ver, lanes, inst.body.clientWidth, inst.body.clientHeight, Pit.prefs.units, themeVer]);
      if (inst.state.k !== k) { inst.state.k = k; inst.state.g = drawTraces(inst.body.querySelector('canvas'), lanes, s.ref, s.cmp && s.cmp.data ? s.cmp : null, c.sel.cursor, {len:c.r ? c.r.fixed.track_length_m : 0}); }
      const rg = inst.state.g && inst.state.g.range;   // the first value lane's range over both laps, e.g. "speed 62–261 km/h"
      inst.setInfo(`${rg ? `${rg.label.toLowerCase()} ${rg.lo}–${rg.hi}${rg.u ? ' ' + rg.u : ''} · ` : ''}REF ${lapName(s.ref)} ${fmtLap(s.ref.ms)}${s.cmp ? ` · CMP ${lapName(s.cmp)} ${fmtLap(s.cmp.ms)} · ${fmtDelta(s.cmp.ms - s.ref.ms)}` : ''}`);
    }});

  // ---------- where the time goes ----------
  const SEG = 20;
  function cause(ref, cmp, a, b, binM){   // brake onset, minimum speed, throttle pickup: the largest normalised difference names it
    const ev = l => { const d = l.data; let bo = null, mi = a, tp = null;
      for (let i = a; i <= b; i++) { if (bo == null && d.brk[i] > 0.1) bo = i; if (d.speed[i] < d.speed[mi]) mi = i; }
      for (let i = mi; i <= b; i++) if (d.thr[i] > 0.9) { tp = i; break; }
      return {bo, mv:d.speed[mi], tp}; };
    const r = ev(ref), m = ev(cmp), out = [], dist = bins => binM ? `${Math.abs(bins * binM).toFixed(0)} m` : `${Math.abs(bins / (NB - 1) * 100).toFixed(1)} %`;
    if (r.bo != null && m.bo != null && m.bo !== r.bo) out.push([Math.abs(m.bo - r.bo) * (binM || 12.5) / 20, `Brakes ${dist(m.bo - r.bo)} ${m.bo < r.bo ? 'earlier' : 'later'}`]);
    const dv = m.mv - r.mv; if (Math.abs(dv) >= 1) out.push([Math.abs(dv) / 5, `Min speed ${dv > 0 ? '+' : MINUS}${Math.abs(un('speed').f(dv)).toFixed(0)} ${un('speed').u}`]);
    if (r.tp != null && m.tp != null && m.tp !== r.tp) out.push([Math.abs(m.tp - r.tp) * (binM || 12.5) / 20, `Throttle ${dist(m.tp - r.tp)} ${m.tp > r.tp ? 'later' : 'earlier'}`]);
    out.sort((x, y) => y[0] - x[0]);
    return out.length && out[0][0] >= 0.2 ? out[0][1] : '—';
  }
  Pit.module({type:'segments', title:'Where the time goes', group:'Analysis', blurb:'The lap cut into 20 parts, ranked by time lost, with the likely cause.',
    size:{w:3, h:10, minW:3, minH:6}, needs:['rec', 'sel', 'reading'],
    build(el){ el.innerHTML = '<table class="tt sg"><thead><tr><th class="n">#</th><th class="n">Distance</th><th class="n">Δ</th><th>Cause</th></tr></thead><tbody></tbody><tfoot></tfoot></table><div class="sg-none"></div>'; el.addEventListener('click', e => { const tr = e.target.closest('tr[data-f]'); if (tr) Pit.setCursor(+tr.dataset.f); }); },
    render(c, inst){
      const s = selState(c, inst); if (!s) return;
      if (!s.cmp || !s.cmp.data) return inst.setState('empty', 'Pick a comparison lap (CMP) as well.');
      const len = c.r ? c.r.fixed.track_length_m : 0, binM = len > 0 ? len / (NB - 1) : 0, R = s.ref.data.t, M = s.cmp.data.t;
      const segs = [];
      for (let k = 0; k < SEG; k++) {
        const a = Math.round(k / SEG * (NB - 1)), b = Math.round((k + 1) / SEG * (NB - 1)), d = (M[b] - M[a]) - (R[b] - R[a]);
        segs.push({k, a, b, d, why:cause(s.ref, s.cmp, a, b, binM)});
      }
      const where = x => len > 0 ? `${Math.round(x.a * binM)}–${Math.round(x.b * binM)} m` : `${(x.a / (NB - 1) * 100).toFixed(0)}–${(x.b / (NB - 1) * 100).toFixed(0)} %`;
      const cur = c.sel.cursor;
      // the parts that differ by 10 ms or more, biggest change first (gain or loss); under 10 ms is noise between two laps of one driver
      const shown = segs.filter(x => Math.abs(x.d) >= 10).sort((x, y) => Math.abs(y.d) - Math.abs(x.d)), why = shown.some(x => x.why && x.why !== '—');
      setHtml(inst.body.querySelector('.sg-none'), shown.length ? '' : '<div class="empty">No part differs by 0.01 s or more.</div>');
      inst.body.querySelector('thead').hidden = !shown.length;
      setHtml(inst.body.querySelector('thead tr'), `<th class="n">#</th><th class="n">Distance</th><th class="n">Δ</th>${why ? '<th>Cause</th>' : ''}`);
      setHtml(inst.body.querySelector('tbody'), shown.map((x, i) => `<tr data-f="${((x.a + x.b) / 2 / (NB - 1)).toFixed(4)}" class="${cur != null && cur * (NB - 1) >= x.a && cur * (NB - 1) <= x.b ? 'sg-on' : ''}" title="Show this part on the traces and the map"><td class="n">${i + 1}</td><td class="n">${where(x)}</td><td class="n">${deltaHtml(x.d)}</td>${why ? `<td class="sg-why">${esc(x.why)}</td>` : ''}</tr>`).join(''));
      // net = the sum of every part = the lap delta of the traces; it differs from the lap times only by the traces' offset
      const gain = segs.filter(x => x.d < 0).reduce((a, x) => a + x.d, 0), loss = segs.filter(x => x.d > 0).reduce((a, x) => a + x.d, 0), net = gain + loss;
      const lapD = s.cmp.ms - s.ref.ms, off = Math.abs(net - lapD) > 5 ? `<span class="note">, trace offset ${nf(Math.abs(net - lapD) / 1000, 3)} s</span>` : '';
      setHtml(inst.body.querySelector('tfoot'), `<tr><td colspan="${why ? 4 : 3}">Gains ${deltaHtml(gain)} · losses ${deltaHtml(loss)} · net ${deltaHtml(net)} (CMP ${MINUS} REF lap ${deltaHtml(lapD)}${off})</td></tr>`);
      inst.setInfo(`CMP ${lapName(s.cmp)} vs REF ${lapName(s.ref)}`);
    }});
})();
