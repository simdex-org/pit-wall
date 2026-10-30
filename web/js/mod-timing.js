'use strict';
// mod-timing.js (D1): standings, relative, battle, pit-activity, sector-compare, session, flags, rules, kpi.
// Everything about other cars comes from ACC's broadcasting feed (ctx.field / ctx.entries / ctx.cars), which publishes
// positions, laps, lap and sector times, pit-lane state and the roster, and nothing about their inputs, fuel or tyres.

(() => {
  const name = (car, form) => { const n = Pit.carName(car, form || 'short'); return esc(/^\S\. *$/.test(n) ? Pit.carName(car, 'full') : n); };   // a driver with no surname: first name
  const num = car => car && car.num != null ? '#' + esc(car.num) : '';
  const sorted = c => [...c.cars.values()].filter(x => x.pos > 0).sort((a, b) => a.pos - b.pos);

  // ---------- standings ----------
  const SCOLS = [['car', 'Car'], ['cup', 'Cup'], ['laps', 'Laps'], ['gap', 'Gap'], ['int', 'Int'], ['last', 'Last'], ['best', 'Best'], ['sectors', 'S1–S3 of the last lap'],
    ['pits', 'Pits'], ['stint', 'Stint'], ['net', 'Net position'], ['deltaMe', 'Δ to my best']];
  Pit.module({type:'standings', title:'Standings', group:'Timing', blurb:'The whole field: positions, gaps, laps and pit stops.',
    size:{w:7, h:16, minW:4, minH:6}, linkable:true, needs:['field', 'entries', 'focus'], requires:['field'], rate:4,
    options:[
      {key:'scope', label:'Show', type:'select', choices:[['all', 'All cars'], ['cup', 'My cup category']], def:'all'},
      {key:'cols', label:'Columns', type:'multi', choices:SCOLS, def:['gap', 'int', 'last', 'best', 'pits', 'stint']},
      {key:'around', label:'Rows around me (0 = all)', type:'number', min:0, max:20, step:1, def:0},
      {key:'names', label:'Names', type:'select', choices:[['short', 'A. Mori'], ['full', 'Aiko Mori'], ['last', 'Mori']], def:'short'},
    ],
    build(el){ el.innerHTML = '<table class="tt std"><thead></thead><tbody></tbody></table>'; clickFocus(el); },
    key: rowKey,
    render(c, inst){
      const o = inst.opts, F = c.field, race = c.mode !== 'best', mine = c.cars.get(c.me), cup = o.scope === 'cup' && mine;
      let rows = sorted(c); if (cup) rows = rows.filter(x => x.cup === mine.cup).sort((a, b) => a.cpos - b.cpos);
      if (!rows.length) return inst.setState('empty', 'Waiting for the field.');
      const has = new Set(o.cols), net = has.has('net') && race && rows.every(x => x.net != null);
      const sb = F.best && F.best.ms, bestS = [0, 1, 2].map(k => Math.min(...rows.map(x => (x.best_s || [])[k]).filter(v => v > 0), Infinity));
      let show = rows;
      if (o.around > 0 && mine) {   // ±around is a minimum: the rows the module has room for are filled outward from you
        const fit = Math.max(1, Math.floor(inst.body.clientHeight / (parseFloat(css('--trow')) || 24)) - 1);
        const k = rows.indexOf(mine); let lo = Math.max(0, k - o.around), hi = Math.min(rows.length, k + o.around + 1);
        const used = () => hi - lo + (lo > 0 ? 1 : 0) + (lo > 1 ? 1 : 0);
        for (let t = 0; used() < fit && (lo > 0 || hi < rows.length); t++) { if (t % 2 ? lo > 0 : hi >= rows.length) lo--; else hi++; }
        show = (lo > 0 ? [rows[0]] : []).concat(lo > 1 ? [null] : [], rows.slice(lo, hi));   // P1 stays on top; null = a gap row
      }
      const narrow = inst.body.clientWidth > 0 && inst.body.clientWidth < 560;   // no room for a tags column: the tags go after the name
      const gapF = (ms, laps) => race ? fmtGap(ms, laps) : fmtDelta(ms);
      const lastCell = x => {
        const v = x.last; if (!okMs(v)) return '—';
        if (x.last_valid === false) return `<span class="t-inv">${fmtLap(v)}</span>`;
        // ● only once a car has a few laps: early on nearly every lap is its best, and the mark would mean nothing
        return v === sb ? `<span class="t-best">◆ ${fmtLap(v)}</span>` : v === x.best && x.laps >= 3 ? `<span class="t-pb">● ${fmtLap(v)}</span>` : fmtLap(v);
      };
      const secCell = (x, k) => { const v = (x.last_s || [])[k]; if (!okMs(v)) return '—'; return v === bestS[k] ? `<span class="t-best">◆ ${fmtSector(v)}</span>` : v === (x.best_s || [])[k] && x.laps >= 3 ? `<span class="t-pb">● ${fmtSector(v)}</span>` : fmtSector(v); };
      // the optional columns, in the order the options list them: [header, cell]
      const COL = {car:['<th>Car</th>', x => `<td class="car" title="${esc(x.model_name)}">${esc(x.model_name || '—')}</td>`], cup:['<th>Cup</th>', x => `<td>${esc(x.cup_name || '—')}</td>`],
        laps:['<th class="n">Laps</th>', x => `<td class="n">${nf(x.laps, 0)}</td>`],
        gap:[`<th class="n">${race ? 'Gap' : 'To P1'}</th>`, x => `<td class="n">${x.pos === 1 ? '—' : gapF(x.gap, x.gap_laps)}</td>`],
        int:[`<th class="n">${race ? 'Int' : 'To next'}</th>`, x => `<td class="n">${x.pos === 1 ? '—' : gapF(x.int, x.int_laps)}</td>`],
        last:['<th class="n">Last</th>', x => `<td class="n">${lastCell(x)}${x.last_valid === false && okMs(x.last) ? ' <b class="tag inv">INV</b>' : ''}</td>`],
        best:['<th class="n">Best</th>', x => `<td class="n">${okMs(x.best) ? (x.best === sb ? `<span class="t-best">◆ ${fmtLap(x.best)}</span>` : fmtLap(x.best)) : '—'}</td>`],
        sectors:['<th class="n">S1</th><th class="n">S2</th><th class="n">S3</th>', x => [0, 1, 2].map(k => `<td class="n">${secCell(x, k)}</td>`).join('')],
        pits:['<th class="n">Pits</th>', x => `<td class="n">${nf(x.pits, 0)}</td>`],
        stint:['<th class="n">Stint</th>', x => `<td class="n">${nf(x.i === c.me && c.s ? c.s.stint_laps : x.stint_laps, 0)}</td>`],   // yours: the bridge's count, as in the KPI strip
        net:['<th class="n">Net</th>', x => `<td class="n">P${x.net}${x.net < x.pos ? ` <span class="s-ok">(+${x.pos - x.net})</span>` : x.net > x.pos ? ` <span class="s-bad">(${MINUS}${x.net - x.pos})</span>` : ''}</td>`],
        deltaMe:['<th class="n" title="My best minus theirs">Δ me</th>', x => `<td class="n">${x.i === c.me || !mine || !okMs(mine.best) || !okMs(x.best) ? '—' : deltaHtml(mine.best - x.best)}</td>`]};
      const cols = o.cols.filter(k => COL[k] && (k !== 'net' || net));
      const head = '<th class="sb"></th><th class="n">Pos</th><th class="n">#</th><th>Driver</th>' + cols.map(k => COL[k][0]).join('') + (narrow ? '' : '<th></th>');
      const ncol = (head.match(/<th/g) || []).length;
      setHtml(inst.body.querySelector('thead'), `<tr>${head}</tr>`);
      const row = x => {
        if (!x) return `<tr class="gaprow"><td class="sb"></td><td colspan="${ncol - 1}" class="note">⋯</td></tr>`;
        const me = x.i === c.me, p = cup ? x.cpos : x.pos;
        return carRow(x, c, inst) + `<td class="sb"></td><td class="n">${p}</td><td class="n">${esc(x.num)}</td><td class="drv" title="${carTitle(x)}">${name(x, o.names)}${me ? ' <b class="tag you">YOU</b>' : ''}${narrow && carTags(x) ? ' ' + carTags(x) : ''}</td>`
          + cols.map(k => COL[k][1](x)).join('') + (narrow ? '' : `<td class="tags">${carTags(x)}</td>`) + '</tr>';
      };
      setHtml(inst.body.querySelector('tbody'), show.map(row).join(''));
      inst.setInfo(`${rows.length} cars${sb ? ` · ◆ ${fmtLap(sb)} #${(c.cars.get(F.best.car) || {}).num != null ? c.cars.get(F.best.car).num : '?'}` : ''} · ${NO_RIVAL}`);
    }});

  // ---------- relative ----------
  Pit.module({type:'relative', title:'Relative', group:'Timing', blurb:'The cars nearest to you on track, ahead and behind, in seconds.',
    size:{w:3, h:8, minW:3, minH:5}, linkable:true, needs:['field', 'entries', 'reading', 'focus'], requires:['reading'], rate:4,
    options:[{key:'rows', label:'Cars each side', type:'number', min:2, max:5, step:1, def:3}, {key:'cls', label:'Class tags', type:'toggle', def:true}],
    build(el){ el.innerHTML = '<table class="tt rel"><tbody></tbody></table><p class="note" hidden></p>'; clickFocus(el); },
    key: rowKey,
    render(c, inst){
      const tb = inst.body.querySelector('tbody'), note = inst.body.querySelector('.note'), mine = c.cars.get(c.me), ss = c.r.session;
      if (!fieldOn(c) || !mine) {   // field off: what shared memory knows, without names
        note.hidden = false; note.textContent = 'Names and lap relation need field timing.';
        setHtml(tb, `<tr data-loc="none"><td class="sb"></td><td>Car ahead</td><td class="n">${ss.gap_ahead_ms > 0 ? fmtRel(ss.gap_ahead_ms) : '—'}</td></tr>`
          + `<tr class="me" data-loc="track"><td class="sb"></td><td>You <b class="tag you">YOU</b></td><td class="n">P${nf(ss.position, 0)}</td></tr>`
          + `<tr data-loc="none"><td class="sb"></td><td>Car behind</td><td class="n">${ss.gap_behind_ms > 0 ? fmtRel(ss.gap_behind_ms) : '—'}</td></tr>`);
        return inst.setInfo('field off');
      }
      note.hidden = true;
      const others = [...c.cars.values()].filter(x => x.i !== c.me && x.rel != null && isFinite(x.rel)), N = inst.opts.rows;
      const ahead = others.filter(x => x.rel > 0).sort((a, b) => a.rel - b.rel).slice(0, N).reverse(), behind = others.filter(x => x.rel < 0).sort((a, b) => b.rel - a.rel).slice(0, N);
      const myD = mine.laps + mine.spl;
      const lapRel = x => { const f = ((x.spl - mine.spl + 1.5) % 1) - .5, k = Math.round(x.laps + x.spl - myD - f); return k > 0 ? `<b class="tag s-dim">+${k}L</b>` : k < 0 ? `<b class="tag s-dim">${MINUS}${-k}L</b>` : ''; };
      const row = x => carRow(x, c, inst) + `<td class="sb"></td><td class="n pos">${c.focus === x.i ? '▶ ' : ''}${num(x)}</td><td class="drv" title="${carTitle(x)}">${x.i === c.me ? `${name(x)} <b class="tag you">YOU</b>` : name(x)} ${carTags(x)}${x.i === c.me ? '' : lapRel(x)}${inst.opts.cls && x.class && x.class !== mine.class ? ` <b class="tag">${esc(x.class)}</b>` : ''}</td><td class="n">${x.i === c.me ? `P${x.pos}` : fmtRel(x.rel)}</td></tr>`;
      setHtml(tb, ahead.concat([mine], behind).map(row).join(''));
      inst.setInfo(`${ahead.length} ahead · ${behind.length} behind`);
    }});

  // ---------- battle ----------
  Pit.module({type:'battle', title:'Battle', group:'Timing', blurb:'The car ahead and the car behind: interval and whether it is closing.',
    size:{w:4, h:6, minW:3, minH:5}, linkable:true, needs:['field', 'entries', 'focus', 'reading'], rate:2,
    build(el){ el.innerHTML = '<div class="bat"></div><p class="note" hidden></p>'; },
    render(c, inst){
      const box = inst.body.firstChild, note = inst.body.lastChild;
      if (c.mode === 'best') { inst.setInfo(''); return inst.setState('empty', 'Battles are tracked in races only.'); }
      const ss = c.r && c.r.session;
      if (!fieldOn(c) || !c.focusCar) {
        note.hidden = false; note.textContent = 'The trend needs field timing.';
        inst.setInfo('field off');
        return setHtml(box, `<dl class="kv">${kvHtml([['Car ahead', ss && ss.gap_ahead_ms > 0 ? fmtRel(ss.gap_ahead_ms) : '—'], ['Car behind', ss && ss.gap_behind_ms > 0 ? fmtRel(ss.gap_behind_ms) : '—']])}</dl>`);
      }
      note.hidden = true;
      const fc = c.focusCar, list = sorted(c), A = list.find(x => x.pos === fc.pos - 1), B = list.find(x => x.pos === fc.pos + 1);
      const who = fc.i === c.me ? 'you' : num(fc);
      const trend = (hist, gap, closer, opener) => {
        const h = (hist || []).filter(v => v != null && isFinite(v)); if (h.length < 2) return '<span class="note">trend after 2 laps</span>';
        const rate = (h[h.length - 1] - h[0]) / (h.length - 1);   // ms per lap; < 0 = the interval is closing
        if (Math.abs(rate) < 20) return '<span class="note">holding</span>';
        if (rate < 0) { const n = gap > 1000 ? Math.ceil((gap - 1000) / -rate) : 0; return `<span class="s-warn">${closer} catching ${(-rate / 1000).toFixed(2)} s/lap</span>${n ? ` · within 1 s in ${n} lap${n > 1 ? 's' : ''}` : ' · within 1 s'}`; }
        return `<span class="note">${opener} pulling away ${(rate / 1000).toFixed(2)} s/lap</span>`;
      };
      const row = (label, car, gap, gl, hist, closer, opener) => car ? `<div class="bat-row"><div class="lbl">${label}</div><div class="bat-main"><span class="drv" title="${carTitle(car)}"><b>${num(car)}</b> ${name(car)}</span><b class="big n">${gl > 0 ? `${gl} lap${gl > 1 ? 's' : ''}` : fmtRel(gap)}</b>${label === 'Behind' && !(gl > 0) && gap != null && gap < 500 ? ' <b class="tag close">CLOSE</b>' : ''}${sparkSvg(hist, v => (v / 1000).toFixed(1))}</div><div class="sub">${trend(hist, gap, closer, opener)}</div></div>`
        : `<div class="bat-row"><div class="lbl">${label}</div><div class="empty">${label === 'Ahead' ? 'Leading.' : 'Last car.'}</div></div>`;
      setHtml(box, row('Ahead', A, fc.int, fc.int_laps, fc.int_hist, who === 'you' ? "you're" : who, A ? num(A) : '')
        + row('Behind', B, B && B.int, B && B.int_laps, B && B.int_hist, B ? num(B) : '', who === 'you' ? "you're" : who));
      inst.setInfo(fc.i === c.me ? `P${fc.pos}` : `${num(fc)} · P${fc.pos}`);
    }});

  // ---------- pit lane activity ----------
  Pit.module({type:'pit-activity', title:'Pit lane', group:'Timing', blurb:'Who is in the pit lane now, and every car\'s stops so far.',
    size:{w:4, h:8, minW:3, minH:5}, needs:['field', 'entries'], requires:['field'], rate:2,
    build(el){ el.innerHTML = '<div class="pa-now"></div><table class="tt pa-all"><thead><tr><th class="sb"></th><th class="n">#</th><th>Driver</th><th class="n">Pits</th><th class="n">Last</th><th class="n">Lane s</th><th class="n">Stint</th></tr></thead><tbody></tbody></table><div class="pa-none"></div>'; clickFocus(el); },
    key: rowKey,
    render(c, inst){
      const F = c.field, st = inst.state, seen = st.seen || (st.seen = new Map()), list = sorted(c);
      for (const x of list) {   // entry time: when this page saw the car leave the track; cars already in the lane at first sight are marked ≥
        const inL = IN_LANE.includes(x.loc), e = seen.get(x.i);
        if (inL && !e) seen.set(x.i, {t:F.t, partial:!st.started}); else if (!inL && e) seen.delete(x.i);
      }
      st.started = true;
      const now = list.filter(x => IN_LANE.includes(x.loc));
      setHtml(inst.body.querySelector('.pa-now'), now.length ? `<table class="tt"><tbody>${now.map(x => { const e = seen.get(x.i);
        return carRow(x, c, inst) + `<td class="sb"></td><td class="n">${num(x)}</td><td class="drv" title="${carTitle(x)}">${name(x)} <b class="tag pit">${esc(String(x.loc).toUpperCase())}</b></td><td class="n">${e ? (e.partial ? '≥ ' : '') + nf((F.t - e.t) / 1000, 1) + '<span class="u"> s</span>' : '—'}</td></tr>`; }).join('')}</tbody></table>`
        : '<div class="empty">Nobody in the pit lane.</div>');
      // only the cars that have stopped, latest stop first: twenty rows of zeros would bury them
      const stopped = list.filter(x => x.pits > 0).sort((a, b) => (b.last_pit_lap || 0) - (a.last_pit_lap || 0) || a.pos - b.pos);
      inst.body.querySelector('.pa-all').hidden = !stopped.length;
      setHtml(inst.body.querySelector('.pa-none'), stopped.length ? '' : '<div class="empty">No stops in the field yet.</div>');
      setHtml(inst.body.querySelector('.pa-all tbody'), stopped.map(x => carRow(x, c, inst) + `<td class="sb"></td><td class="n">${num(x)}</td><td class="drv" title="${carTitle(x)}">${name(x)}${x.i === c.me ? ' <b class="tag you">YOU</b>' : ''}</td><td class="n">${nf(x.pits, 0)}</td><td class="n">${x.last_pit_lap != null ? 'L' + x.last_pit_lap : '—'}</td><td class="n">${x.lane_ms ? nf(x.lane_ms / 1000, 1) : '—'}</td><td class="n">${nf(x.stint_laps, 0)}</td></tr>`).join(''));
      inst.setInfo(`${now.length} in the lane · ${plural(list.reduce((a, x) => a + (x.pits || 0), 0), 'stop')}`);
    }});

  // ---------- you vs the focus car ----------
  Pit.module({type:'sector-compare', title:'You vs focus car', group:'Timing', blurb:'Your last and best lap against the focus car (or the car ahead), sector by sector.',
    size:{w:4, h:8, minW:3, minH:6}, linkable:true, needs:['field', 'entries', 'focus', 'laps'], requires:['field'], rate:2,
    build(el){ el.innerHTML = '<table class="tt sc"><thead><tr><th></th><th class="n">Lap</th><th class="n">S1</th><th class="n">S2</th><th class="n">S3</th></tr></thead><tbody></tbody></table><div class="sc-int"></div>'; },
    render(c, inst){
      const mine = c.cars.get(c.me); if (!mine) return inst.setState('empty', 'Your car is not in the field yet.');
      const other = c.focus !== 'self' && c.cars.get(c.focus) || sorted(c).find(x => x.pos === mine.pos - 1);
      if (!other) return inst.setState('empty', 'You are leading: pick a car to compare with.');
      const L = c.laps || [], last = L[L.length - 1], ok = L.filter(l => l.valid && l.ms > 0), best = ok.length ? ok.reduce((a, b) => b.ms < a.ms ? b : a) : null;
      const mineSet = {last:last ? [last.ms].concat(last.s || []) : [mine.last].concat(mine.last_s || []), best:best ? [best.ms].concat(best.s || []) : [mine.best].concat(mine.best_s || [])};
      const theirs = {last:[other.last].concat(other.last_s || []), best:[other.best].concat(other.best_s || [])};
      const cell = (v, k) => `<td class="n">${k ? fmtSector(v) : fmtLap(v)}</td>`;
      const block = (k, label) => `<tr class="tt-group"><td colspan="5">${label}</td></tr><tr class="me"><td>You</td>${mineSet[k].slice(0, 4).map(cell).join('')}</tr>`
        + `<tr><td title="${carTitle(other)}">${num(other)}</td>${theirs[k].slice(0, 4).map(cell).join('')}</tr>`
        + `<tr><td class="note">Δ you</td>${[0, 1, 2, 3].map(i => `<td class="n">${okMs(mineSet[k][i]) && okMs(theirs[k][i]) ? deltaHtml(mineSet[k][i] - theirs[k][i]) : '—'}</td>`).join('')}</tr>`;
      setHtml(inst.body.querySelector('tbody'), block('last', 'Last lap') + block('best', 'Best lap'));
      const ahead = other.pos === mine.pos - 1, hist = c.mode === 'best' ? [] : ahead ? mine.int_hist : other.int_hist;   // intervals mean nothing in best-lap sessions
      setHtml(inst.body.querySelector('.sc-int'), (hist || []).length ? `<div class="lbl">${ahead ? 'Your interval to it, last 5 laps' : `${num(other)}'s interval to the car ahead, last 5 laps`}</div><div class="sub">${hist.slice(-5).map(v => `<b class="n">${fmtRel(v)}</b>`).join('')}</div>` : '');
      inst.setInfo(`vs ${num(other)} ${Pit.carName(other, 'short')}`);
    }});

  // ---------- session ----------
  Pit.module({type:'session', title:'Session', group:'Timing', blurb:'Car, class, track, session, time left and conditions.',
    size:{w:4, h:7, minW:3, minH:5}, needs:['reading', 'field', 'entries', 'tick'], requires:['reading'],
    build(el){ el.innerHTML = '<dl class="kv"></dl>'; },
    render(c, inst){
      const f = c.r.fixed, s = c.r.session, E = c.entries, len = E && E.track && E.track.length_m || f.track_length_m, st = c.st;
      const ph = fieldOn(c) && c.field.phase != null ? PHASES[c.field.phase] : '';
      const tot = s.total_laps > 0 ? ' / ' + s.total_laps : st && st.laps_to_go != null ? ` / ≈${s.completed_laps + st.laps_to_go}` : '';
      const tod = s.clock_s != null && isFinite(s.clock_s) ? `${String(Math.floor(s.clock_s / 3600) % 24).padStart(2, '0')}:${String(Math.floor(s.clock_s % 3600 / 60)).padStart(2, '0')}` : '—';
      setHtml(inst.body.firstChild, kvHtml([['Car', esc((f.car_model || '—').replace(/_/g, ' '))], ['Class', esc(f.car_class || '—')],
        ['Track', `${esc(f.track || '—')}${len ? `<span class="u"> ${(len / 1000).toFixed(3)} km</span>` : ''}`], ['Session', `${esc(s.kind || '—')}${ph ? `<span class="u"> · ${esc(ph)}</span>` : ''}`],
        ['Time left', fmtClock(s.session_time_left_ms)], ['Lap', `${nf(s.lap_number != null ? s.lap_number : s.completed_laps + 1, 0)}${tot}`],
        ['Timed race', f.is_timed_race ? 'yes' + (f.has_extra_lap ? ' + extra lap' : '') : 'no'], ['Online', f.is_online ? 'yes' : 'no'], ['Time of day', tod],
        ['Fuel rate', '×' + nf(f.fuel_rate, 1)], ['Tyre rate', '×' + nf(f.tyre_rate, 1)]]));
    }});

  // ---------- flags and penalties ----------
  const GF = [['yellow', 'Y', 'yellow'], ['y1', 'S1', 'yellow'], ['y2', 'S2', 'yellow'], ['y3', 'S3', 'yellow'], ['white', 'White', 'white'], ['green', 'Green', 'green'], ['chequered', 'Chequered', 'chequered'], ['red', 'Red', 'red']];
  Pit.module({type:'flags', title:'Flags & penalties', group:'Timing', blurb:'The flag the driver sees, sector yellows, and any penalty to serve.',
    size:{w:4, h:6, minW:3, minH:4}, needs:['reading', 'summary'], requires:['reading'],
    build(el){ el.innerHTML = '<div class="fl-main"></div><div class="fl-glob"></div><div class="fl-pen"></div>'; },
    render(c, inst){
      const s = c.r.session, f = FLAGS[s.flag] || 'none', gf = s.global_flags || {}, pen = s.penalty | 0, sp = c.s && c.s.penalty;
      setHtml(inst.body.querySelector('.fl-main'), f === 'none' ? '<b class="s-dim">No flag for the driver</b>' : `<span class="flag big-flag" data-flag="${f}"></span><b>${esc(f.toUpperCase())}</b>`);
      // the track's flags: only the ones out, as a swatch and a word; none out reads as one line, not eight empty boxes
      const on = GF.filter(([k]) => gf[k]);
      setHtml(inst.body.querySelector('.fl-glob'), on.length ? on.map(([, l, fl]) => `<span class="chip on"><span class="flag" data-flag="${fl}"></span>${l}</span>`).join('') : '<span class="chip"><span class="flag" data-flag="green"></span>Track clear</span>');
      const P = PENALTIES[pen] || ['?', 'unknown penalty'];
      setHtml(inst.body.querySelector('.fl-pen'), pen ? `<b class="tag pen">${esc(P[0])}</b> ${esc(P[1])}${s.penalty_time_s > 0 ? ` · ${nf(s.penalty_time_s, 0)} s` : ''}${sp && sp.laps_left != null ? ` · <b class="s-bad">serve within ${sp.laps_left} lap${sp.laps_left === 1 ? '' : 's'}</b>` : ''}` : '<span class="note">No penalty.</span>');
      inst.setAlert(pen ? 2 : (gf.y1 || gf.y2 || gf.y3 || gf.yellow || f === 'yellow') ? 1 : 0);
      inst.setInfo(s.track_status || '');
    }});

  // ---------- stint rules ----------
  Pit.module({type:'rules', title:'Stint rules', group:'Timing', blurb:'Mandatory stops, the pit window and the driver stint limits.',
    size:{w:3, h:4, minW:3, minH:4}, needs:['reading', 'summary'], requires:['reading'],
    build(el){ el.innerHTML = '<dl class="kv"></dl>'; },
    render(c, inst){
      const s = c.r.session, st = c.st, ml = st ? st.mandatory_left : null, w = st && st.pit_window, lap = s.lap_number || s.completed_laps + 1;
      const mand = ml === 0 ? '<span class="s-ok">done ●</span>' : ml > 0 ? `<span class="s-warn">${ml} left</span>` : s.kind !== 'Race' ? '<span class="note">none outside races</span>' : '<span class="note">unknown: set in Settings</span>';
      const win = !w ? '—' : `L${w.open_lap}–L${w.close_lap} <span class="note">${lap < w.open_lap ? `opens in ${w.open_lap - lap} lap${w.open_lap - lap > 1 ? 's' : ''}` : lap <= w.close_lap ? 'open' : 'closed'} · ${w.src === 'config' ? 'set' : 'ACC'}</span>`;
      const lim = ms => ms == null || !isFinite(ms) ? '—' : ms < 0 ? 'no limit' : fmtClock(ms);
      setHtml(inst.body.firstChild, kvHtml([['Mandatory stops', mand], ['Pit window', win], ['Driver stint left', lim(s.stint_time_left_ms)], ['Driver total left', lim(s.stint_total_time_left_ms)]]));
      inst.setAlert(c.s && (c.s.advice || []).some(a => a.id === 'window_closing') ? 1 : 0);
    }});

  // ---------- one big number ----------
  const KPI_CHOICES = [['session', 'Session'], ['left', 'Time left'], ['lap', 'Lap'], ['pos', 'Position'], ['ahead', 'Gap ahead'], ['behind', 'Gap behind'], ['last', 'Last lap'],
    ['best', 'Best lap'], ['delta', 'Live Δ'], ['fuel', 'Fuel'], ['stint', 'Stint'], ['flag', 'Flag'], ['temps', 'Track / air'], ['grip', 'Grip'], ['rain', 'Rain'],
    ['penalty', 'Penalty'], ['stintTime', 'Driver stint'], ['boxIn', 'Box in'], ['gear', 'Gear'], ['speed', 'Speed'], ['fuelL', 'Fuel litres']];
  Pit.module({type:'kpi', title:'Big number', group:'Timing', blurb:'One figure, large: for a driver-facing or second screen.',
    size:{w:2, h:3, minW:2, minH:2}, needs:['reading', 'summary', 'field'],
    options:[{key:'metric', label:'Figure', type:'select', choices:KPI_CHOICES, def:'pos'}, {key:'label', label:'Label (empty = the figure\'s name)', type:'text', def:''}],
    build(el){ el.innerHTML = '<div class="lbl"></div><div class="big xl"></div>'; },
    render(c, inst){
      const m = inst.opts.metric, car = c.r && c.r.car;
      // ponytail: the KPI strip's cell function (main.js) is reused for its ids, so both always agree
      const [l, v] = m === 'gear' ? ['Gear', !car ? '—' : car.gear < 0 ? 'R' : car.gear === 0 ? 'N' : String(car.gear)]
        : m === 'speed' ? ['Speed', car ? fvu('speed', car.speed_kmh) : '—'] : m === 'fuelL' ? ['Fuel', car ? `${nf(car.fuel_litres, 1)}<span class="u"> L</span>` : '—']
        : typeof kpiCell === 'function' ? kpiCell(m) : [m, '—'];
      inst.body.firstChild.textContent = inst.opts.label || l;
      setHtml(inst.body.lastChild, v);
    }});
})();
