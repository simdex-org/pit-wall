'use strict';
// mod-strategy.js (D1): fuel, race-plan, stint-timeline, stop-options, rejoin, stops, weather, degradation.
// The page computes no strategy maths: every fuel, lap, stop, loss and rejoin figure is summary.strategy (ctx.st), worked
// out once in the bridge (Telemetry.strategy) so that every screen on every PC shows the same numbers.
(() => {
  const L_ = v => `${nf(v, 1)}<span class="u"> L</span>`;
  const S_ = v => `${nf(v, 1)}<span class="u"> s</span>`;
  const keyMsg = () => Pit.key ? '' : 'Needs the access key (Settings › Connection) to change shared values.';
  // Stop options, best first: the ones the fuel reaches, then fewest stops to the flag, then rejoin, then time lost.
  // race-plan names the same first row, so both modules always agree on "the" stop.
  const rankOpts = st => (st && st.options || []).slice().sort((a, b) => (b.reach !== false) - (a.reach !== false) || (a.more_stops || 0) - (b.more_stops || 0)
    || (a.rejoin_pos == null) - (b.rejoin_pos == null) || (a.rejoin_pos || 0) - (b.rejoin_pos || 0) || a.loss_s - b.loss_s);
  const isRace = c => c.r ? c.r.session.kind === 'Race' : c.mode !== 'best';
  const postMsg = r => r.status === 200 ? 'Saved for everyone watching this bridge.' : r.status === 403 ? 'Wrong or missing access key: Settings › Connection.' : r.status === 0 ? r.text : 'Refused: ' + r.text;

  // ---------- fuel ----------
  Pit.module({type:'fuel', title:'Fuel', group:'Strategy', blurb:'Laps of fuel left, litres in the tank and consumption.',
    size:{w:3, h:7, minW:3, minH:5}, needs:['reading', 'summary', 'config'], requires:['reading'],
    build(el){ el.innerHTML = '<div class="lbl">Laps of fuel</div><div class="big"></div><div class="sub"></div><div class="gauge fu-g"><i></i><b></b></div><dl class="kv"></dl>'; },
    render(c, inst){
      const st = c.st, car = c.r.car, fx = c.r.fixed, lf = st && st.laps_of_fuel, fs = fuelState(lf, c), fpl = st && st.fuel_per_lap || c.r.session.fuel_per_lap;
      const b = inst.body;
      setHtml(b.querySelector('.big'), `<span class="${fs === 'bad' ? 's-bad' : fs === 'warn' ? 's-warn' : ''}">${nf(lf)}</span><span class="u"> laps</span>${fs === 'bad' ? ' <b class="tag low">LOW</b>' : ''}`);
      setHtml(b.querySelector('.sub'), `<span><b>${nf(car.fuel_litres)}</b> L in the tank</span>`);
      const max = fx.max_fuel > 0 ? fx.max_fuel : 0, g = b.querySelector('.fu-g');
      g.hidden = !max;
      if (max) { g.firstChild.style.width = clamp(car.fuel_litres / max * 100, 0, 100) + '%'; g.firstChild.className = fs === 'bad' ? 's-bad' : ''; g.lastChild.style.left = clamp(fuelLow(c) * (fpl || 0) / max * 100, 0, 100) + '%'; g.title = `Tick: ${fuelLow(c)} laps of fuel, the low-fuel warning`; }
      const stint = c.s && c.s.stint || [], lastL = stint.length ? stint[stint.length - 1].fuel : null;
      setHtml(b.querySelector('.kv'), kvHtml([['Per lap', `${nf(fpl, 2)}<span class="u"> L</span>`], ['Last lap', `${nf(lastL, 2)}<span class="u"> L</span>`],
        ['Used this session', L_(c.r.session.used_fuel_l)], ['Tank capacity', max ? L_(max) : '—']]));
      inst.setAlert(fs === 'bad' ? 2 : 0);
    }});

  // ---------- fuel to the flag ----------
  Pit.module({type:'race-plan', title:'Fuel to the flag', group:'Strategy', blurb:'When to box and how much fuel to put in, from the bridge strategy.',
    size:{w:4, h:11, minW:3, minH:8}, needs:['summary', 'reading', 'config'], requires:['summary'],
    build(el, inst){
      // the shared inputs (set once per race, shared by every screen) fold away, closed by default: the plan needs the room
      el.innerHTML = `<div class="rp-head"></div><dl class="kv"></dl><div class="rp-acts"><button type="button" class="btn" data-plan>Put in pit plan</button></div>
        <details class="rp-in"><summary class="lbl">Shared inputs</summary>
          <div class="rp-g"><label class="rp-f"><span>Reserve laps</span><input type="number" data-k="reserve_laps" min="0" max="10" step="0.1"></label>
          <label class="rp-f"><span>Laps override</span><input type="number" data-k="laps_override" min="1" max="999" step="1" placeholder="auto"></label>
          <label class="rp-f"><span>Mandatory stops</span><input type="number" data-k="mandatory_stops" min="0" max="9" step="1" placeholder="ACC"></label></div>
          <div class="rp-acts"><button type="button" class="btn" data-save>Save</button></div>
          <p class="note" data-msg role="status"></p></details>`;
      el.addEventListener('input', e => { if (e.target.dataset.k) inst.state.edited = true; });
      el.addEventListener('click', async e => {
        const msg = el.querySelector('[data-msg]');
        if (e.target.closest('[data-plan]')) {
          const st = Pit.ctx.st; if (!st || st.add_at_box_l == null) return;
          const n = Math.ceil(st.add_at_box_l); Pit.emit('plan', {fuel:n}); Pit.say(`Fuel ${n} L put in the pit plan`); return;
        }
        if (!e.target.closest('[data-save]')) return;
        const v = k => el.querySelector(`[data-k="${k}"]`).value, int = k => v(k) === '' ? null : Math.round(+v(k));
        const body = {strategy:{reserve_laps:+v('reserve_laps') || 0, laps_override:int('laps_override'), mandatory_stops:int('mandatory_stops')}};
        msg.textContent = 'Saving…';
        const r = await Pit.post('/config', body);
        msg.textContent = postMsg(r); if (r.status === 200) inst.state.edited = false;
      });
    },
    render(c, inst){
      const st = c.st, b = inst.body; if (!st) return inst.setState('empty', 'Waiting for the bridge strategy figures.');
      const ss = c.r && c.r.session, car = c.r && c.r.car, cap = c.r && c.r.fixed.max_fuel > 0 ? c.r.fixed.max_fuel : null, w = st.pit_window;
      const lapNow = ss ? (ss.lap_number != null ? ss.lap_number : ss.completed_laps + 1) : null, race = isRace(c), box = race && st.stops_needed > 0;
      const late = (st.options || []).find(o => o.id === 'late_f'), top = rankOpts(st)[0];
      let head, crit = false;
      if (!race) head = `<div class="lbl">Fuel lasts to the end of lap</div><div class="big">${st.box_by_lap != null ? 'L' + st.box_by_lap : '—'}${st.box_in_laps > 0 ? `<span class="u"> in ${plural(st.box_in_laps, 'lap')}</span>` : ''}</div><p class="note">Fuel to the flag is planned in races only.</p>`;
      else if (box && (st.box_in_laps <= 0 || st.box_by_lap != null && lapNow != null && st.box_by_lap < lapNow)) { head = '<div class="lbl">Fuel</div><div class="big s-bad">■ BOX THIS LAP</div>'; crit = true; }
      else if (box) head = `<div class="lbl">Box by end of lap</div><div class="big">${st.box_by_lap != null ? 'L' + st.box_by_lap : '—'}<span class="u"> in ${plural(st.box_in_laps, 'lap')}</span></div>`;
      else head = `<div class="lbl">Fuel to the flag</div><div class="big">${nf(st.spare_l)}<span class="u"> L spare</span></div>`;
      if (box && w && st.box_by_lap != null && st.box_by_lap < w.open_lap) head += `<p class="s-warn">▲ The fuel runs out before the pit window opens (L${w.open_lap}).</p>`;
      if (box && top && top.reach !== false && top.lap !== st.box_by_lap) head += `<p class="note">Best stop: ${esc(top.label)}, see Stop options.</p>`;
      setHtml(b.querySelector('.rp-head'), head);
      const pace = {leader:"leader's", own:'own', best:'best-lap'}[st.lap_ref_src] || '';
      const src = st.laps_src === 'timed' ? `timed, ${pace} pace ${fmtLap(st.lap_ref_ms)}` : st.laps_src === 'laps' ? 'lap count' : st.laps_src === 'override' ? 'set by hand' : '';
      const save = st.save_lpl != null && st.fuel_per_lap > 0 ? `${nf(st.save_lpl, 2)}<span class="u"> L/lap</span> <span class="note">${MINUS}${nf((1 - st.save_lpl / st.fuel_per_lap) * 100, 0)} %</span>` : null;
      // "now" is what the tank takes now; what does not fit is said, not shown as a figure that cannot go in
      const room = cap != null && car ? Math.max(0, cap - car.fuel_litres) : null, addNow = st.fuel_to_add_l != null && room != null ? Math.min(st.fuel_to_add_l, room) : st.fuel_to_add_l;
      const over = st.fuel_to_add_l != null && addNow != null ? st.fuel_to_add_l - addNow : 0;
      const showNow = box && st.box_in_laps > 0 && addNow != null && (st.add_at_box_l == null || Math.abs(addNow - st.add_at_box_l) >= 1);   // boxing this lap: the box figure is the one
      setHtml(b.querySelector('.kv'), race ? kvHtml([['Laps to go', `${nf(st.laps_to_go, 0)}${src ? ` <span class="note">${esc(src)}</span>` : ''}`],
        ['Fuel needed', L_(st.fuel_needed_l)], ['In tank', car ? L_(car.fuel_litres) : '—'],
        showNow && (over >= 0.5 ? ['Room in tank now', `${L_(addNow)} <span class="note">${nf(over, 0)} L short of the flag</span>`] : ['To add now', L_(addNow)]),
        ['Add at the box', box ? `${L_(st.add_at_box_l)}${late && late.more_stops > 0 ? ` <span class="note">then ${plural(late.more_stops, 'more stop')}</span>` : ''}` : '—'],
        ['Stops needed', `${nf(st.stops_needed, 0)}${st.stops_why ? ` <span class="note">${esc(st.stops_why)}</span>` : ''}`],
        save && ['Save to make it', save]])
        : kvHtml([['In tank', car ? L_(car.fuel_litres) : '—'], ['Per lap', `${nf(st.fuel_per_lap, 2)}<span class="u"> L</span>`], ['Laps of fuel', nf(st.laps_of_fuel)]]));
      const S = c.cfg && c.cfg.strategy, km = keyMsg(), msg = b.querySelector('[data-msg]');
      for (const i of b.querySelectorAll('[data-k]')) { i.disabled = !!km; if (S && !inst.state.edited && document.activeElement !== i) i.value = S[i.dataset.k] == null ? '' : S[i.dataset.k]; }
      b.querySelector('[data-save]').disabled = !!km;
      b.querySelector('[data-plan]').disabled = !box || st.add_at_box_l == null;   // practice and qualifying: nothing to plan to the flag
      if (km && !msg.textContent) msg.textContent = km;
      const sev = Math.max(0, ...(c.s.advice || []).filter(a => /^fuel_(low|box|flag)$/.test(a.id)).map(a => a.severity | 0));
      inst.setAlert(crit ? 2 : Math.min(2, sev));   // header and body agree: BOX THIS LAP is red in both
    }});

  // ---------- stint timeline ----------
  Pit.module({type:'stint-timeline', title:'Stint timeline', group:'Strategy', blurb:'The race on one lap axis: stints done, fuel range, pit window, planned box and the flag.',
    size:{w:12, h:4, minW:6, minH:3}, needs:['summary', 'reading', 'laps'],
    build(el){ el.innerHTML = '<div class="stl-wrap"></div>'; },
    render(c, inst){
      const ss = c.r && c.r.session, st = c.st, s = c.s; if (!ss || !st) return inst.setState('empty', 'Waiting for the driver and the bridge strategy.');
      const wrap = inst.body.firstChild, W = wrap.clientWidth, H = wrap.clientHeight; if (W < 50 || H < 30) return;
      const done = ss.completed_laps, now = done + ss.track_position, lf = st.laps_of_fuel || 0, lapN = ss.lap_number != null ? ss.lap_number : done + 1, race = isRace(c);
      const total = race && st.laps_to_go != null ? done + st.laps_to_go : Math.ceil(now + lf + 2);
      const stints = (s.stints || []), cur = stints.find(x => x.current), w = st.pit_window;
      const key = JSON.stringify([W, H, total, Math.round(now * 10), Math.round(lf * 10), stints, w, st.box_by_lap, st.stops_needed, st.laps_src]);
      if (inst.state.k === key) return; inst.state.k = key;
      const pl = 4, pr = 4, top = 14, bot = H - 14, x = L => (pl + clamp(L, 0, total) / Math.max(1, total) * (W - pl - pr)).toFixed(1), bw = (a, b) => Math.max(0, x(b) - x(a)).toFixed(1);
      const lab = (x0, wd, y, t, cls) => wd > t.length * 6 + 6 ? `<text class="${cls || 'stl-t'}" x="${(+x0 + 4).toFixed(1)}" y="${y}">${t}</text>` : '';
      const pid = 'stlh-' + inst.id, mid = ((top + bot) / 2 + 4).toFixed(1);
      let g = `<defs><pattern id="${pid}" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line class="stl-hl" x1="0" y1="0" x2="0" y2="6"/></pattern></defs>`;
      const step = [1, 2, 5, 10, 20, 50].find(k => total / k * 36 < W) || 100;
      for (let L = 0; L <= total; L += step) g += `<line class="stl-tick" x1="${x(L)}" y1="${bot}" x2="${x(L)}" y2="${bot + 3}"/><text class="stl-ax" x="${x(L)}" y="${H - 1}" text-anchor="${L === 0 ? 'start' : x(L) > W - pr - 12 ? 'end' : 'middle'}">${L}</text>`;
      g += `<line class="stl-base" x1="${pl}" y1="${bot}" x2="${W - pr}" y2="${bot}"/>`;
      const boxOn = race && st.stops_needed > 0 && st.box_by_lap != null;
      if (w && race) {   // a pit window is a race rule; its label moves to the band's right end only when the BOX line crosses it
        const wt = `WINDOW L${w.open_lap}–${w.close_lap}`, wd = bw(w.open_lap - 1, w.close_lap), bx = boxOn ? x(st.box_by_lap) - x(w.open_lap - 1) : -1e9, near = bx >= -2 && bx < wt.length * 6 + 12;
        g += `<rect class="stl-win" x="${x(w.open_lap - 1)}" y="${top}" width="${wd}" height="${bot - top}"/>`
          + (!near ? lab(x(w.open_lap - 1), wd, top + 9, wt, 'stl-wt') : wd > wt.length * 6 + 6 ? `<text class="stl-wt" x="${(x(w.close_lap) - 4).toFixed(1)}" y="${top + 9}" text-anchor="end">${wt}</text>` : '');
      }
      const by = top + 13, bh = bot - top - 16;   // the window's label sits above the bars, inside its band
      for (const t of stints.filter(t => !t.current && t.from != null)) {
        const a = t.from - 1, b = t.to;
        g += `<rect class="stl-st${t.wet ? ' wet' : ''}" x="${x(a)}" y="${by}" width="${bw(a, b)}" height="${bh}"/>` + lab(x(a), bw(a, b), mid, `S${t.n} · ${t.wet ? 'W' : 'D'}${t.tyre_set || ''} · ${t.laps} L`);
      }
      const cs = cur && cur.from != null ? cur.from - 1 : (stints.filter(t => !t.current && t.to != null).map(t => t.to).pop() || 0);
      if (cur) g += `<rect class="stl-cur${cur.wet ? ' wet' : ''}" x="${x(cs)}" y="${by}" width="${bw(cs, now)}" height="${bh}"/>` + lab(x(cs), bw(cs, now), mid, `S${cur.n} · ${cur.wet ? 'W' : 'D'}${cur.tyre_set || ''} · ${cur.laps} L`);
      const fe = now + lf, short = race && fe < total;   // no flag outside races: nothing to be short of
      // the label names where the bar ends (the box lap is the BOX line's), and is dropped rather than drawn across that line
      const fw = boxOn && x(st.box_by_lap) > +x(now) ? Math.min(bw(now, fe), x(st.box_by_lap) - x(now) - 4) : bw(now, fe);
      if (lf > 0) g += `<rect class="stl-fuel${short ? ' short' : ''}" x="${x(now)}" y="${by}" width="${bw(now, fe)}" height="${bh}"${short ? ` fill="url(#${pid})"` : ''}/>` + lab(x(now), fw, mid, short ? `fuel to ≈L${Math.ceil(fe)} · short of flag` : race ? 'fuel to the flag' : `fuel to ≈L${Math.ceil(fe)}`);
      if (boxOn) g += `<line class="stl-box" x1="${x(st.box_by_lap)}" y1="${top}" x2="${x(st.box_by_lap)}" y2="${bot}"/><text class="stl-top" x="${x(st.box_by_lap)}" y="${top - 3}" text-anchor="middle">BOX L${st.box_by_lap}</text>`;
      if (race && st.laps_to_go != null) g += `<line class="stl-flag" x1="${x(total)}" y1="${top}" x2="${x(total)}" y2="${bot}"/><text class="stl-top" x="${x(total)}" y="${top - 3}" text-anchor="end">FLAG ${st.laps_src === 'timed' ? '≈' : ''}L${total}</text>`;
      g += `<line class="stl-now" x1="${x(now)}" y1="${top - 2}" x2="${x(now)}" y2="${bot}"/><path class="stl-nowm" d="M${x(now)} ${bot} l-4 6 h8 z"/>`;
      wrap.innerHTML = `<svg class="stl" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Stint timeline: ${stints.length} stints, lap ${lapN} of about ${total}${short ? ', fuel short of the flag' : ''}">${g}</svg>`;
      inst.setInfo(`lap ${lapN}${race && st.laps_to_go != null ? ` / ${st.laps_src === 'timed' ? '≈' : ''}${total}` : ''} · ${plural(stints.length, 'stint')}${race ? '' : ' · flag planned in races only'}`);
    }});

  // ---------- stop options ----------
  Pit.module({type:'stop-options', title:'Stop options', group:'Strategy', blurb:'Box now, at the last lap the fuel allows, or when the window opens: loss and rejoin position.',
    size:{w:6, h:7, minW:5, minH:6}, needs:['summary', 'field'], requires:['summary'],
    build(el){ el.innerHTML = '<table class="tt so"><thead></thead><tbody></tbody></table><p class="note"></p>'; },
    render(c, inst){
      const st = c.st, ranked = rankOpts(st);
      if (!isRace(c)) return inst.setState('empty', 'Stop options are planned in races only.');
      if (!ranked.length) return inst.setState('empty', 'Stop options appear once a lap time and the fuel use are known.');
      // rows that differ only in the lap are one row: "Box L11–L18, fuel + tyres", but only when no other option's lap lies inside that range
      const kOf = o => [o.id.endsWith('_ft'), nf(o.add_l, 1), nf(o.stationary_s, 1), nf(o.loss_s, 1), o.rejoin_pos, o.more_stops, o.reach !== false, !!o.outside_window].join();
      const groups = [];
      for (const o of ranked) {
        const k = kOf(o);
        const g = groups.find(x => { if (x.k !== k) return false; const a = Math.min(o.lap, ...x.laps), b = Math.max(o.lap, ...x.laps); return !ranked.some(p => p.lap > a && p.lap < b && kOf(p) !== k); });
        if (g) g.laps.push(o.lap); else groups.push({k, o, laps:[o.lap]});
      }
      const opts = groups.map(({o, laps}) => { const a = Math.min(...laps), b = Math.max(...laps);
        return a === b ? {...o, lapTxt:`L${nf(o.lap, 0)}`} : {...o, lap:a, lapTxt:`L${a}–${b}`, label:`Box L${a}–L${b}, fuel${o.id.endsWith('_ft') ? ' + tyres' : ''}`}; });
      const est = (st.refuel_src === 'est' || st.tyre_src === 'est') ? ' <b class="tag est">est.</b>' : '', slim = inst.body.clientWidth > 0 && inst.body.clientWidth < 560;   // a phone: lap, loss, rejoin and the flag first
      setHtml(inst.body.querySelector('thead'), `<tr><th>Option</th><th class="n">Lap</th>${slim ? '' : `<th class="n">Add L</th><th class="n">Stationary s${est}</th>`}<th class="n">Total loss s</th><th class="n">Rejoin</th><th>To the flag</th></tr>`);
      const top = opts[0].reach !== false ? opts[0] : null;   // ranked: reachable, fewest stops, rejoin, loss
      const flag = o => o.reach === false ? `<span class="s-bad">■ fuel lasts to L${nf(st.box_by_lap, 0)}</span>` : o.more_stops > 0 ? `<span class="s-warn">+${plural(o.more_stops, 'stop')}${o.outside_window ? ': mandatory in window' : ''}</span>` : 'yes';
      setHtml(inst.body.querySelector('tbody'), opts.map(o => `<tr class="${[o === top && 'so-best', o.reach === false && 'so-off'].filter(Boolean).join(' ')}"><td>${o === top ? '▶ ' : ''}${esc(o.label)}</td><td class="n">${o.lapTxt}</td>${slim ? '' : `<td class="n">${nf(o.add_l, 1)}</td><td class="n">${nf(o.stationary_s, 1)}</td>`}<td class="n">${nf(o.loss_s, 1)}</td><td class="n">${o.rejoin_pos != null ? 'P' + o.rejoin_pos : '—'}</td><td>${flag(o)}</td></tr>`).join(''));
      inst.body.querySelector('.note').textContent = `Loss = drive-through ${nf(st.drive_loss_s, 1)} s (${st.drive_loss_src === 'measured' ? 'measured' : 'from Settings until a stop is measured'}) + stationary. Rejoin assumes the others keep their pace.`;
      inst.setInfo(`refuel ${nf(st.refuel_s_per_l, 2)} s/L (${st.refuel_src}) · tyres ${nf(st.tyre_s, 0)} s (${st.tyre_src})`);
    }});

  // ---------- rejoin ----------
  Pit.module({type:'rejoin', title:'Rejoin', group:'Strategy', blurb:'Where you come out if you box at the end of this lap, and who is around you.',
    size:{w:4, h:7, minW:3, minH:6}, needs:['summary', 'field', 'entries'], requires:['field'],
    build(el){ el.innerHTML = '<div class="lbl">Rejoin if you box this lap</div><div class="big"></div><table class="tt rj"><thead><tr><th class="sb"></th><th class="n">Pos</th><th>Car</th><th class="n">Gap to you s</th></tr></thead><tbody></tbody></table>'; },
    render(c, inst){
      if (c.mode === 'best') return inst.setState('empty', 'Rejoin is predicted in races only.');
      const st = c.st, rj = st && st.rejoin; if (!rj) return inst.setState('empty', 'Rejoin needs a lap time and the field first.');
      const b = inst.body, nm = i => { const car = c.cars.get(i); return car ? `#${esc(car.num)} ${esc(Pit.carName(car, 'short'))}` : '—'; }, mine = c.cars.get(c.me);
      setHtml(b.querySelector('.big'), `P${rj.pos}${mine && mine.net != null ? `<span class="u"> · net P${mine.net}</span>` : ''}`);
      const k = (rj.around || []).findIndex(a => a.i === c.me);
      setHtml(b.querySelector('tbody'), (rj.around || []).map((a, j) => { const car = c.cars.get(a.i) || {i:a.i, loc:'track'};
        return `<tr data-loc="${carLoc(car)}" class="${a.i === c.me ? 'me' : ''}"><td class="sb"></td><td class="n">P${k >= 0 ? rj.pos + j - k : '?'}</td><td>${a.i === c.me ? `${esc((n => /^\S\. *$/.test(n) ? Pit.carName(mine, 'full') : n)(Pit.carName(mine, 'short')) || 'You')} <b class="tag you">YOU</b>` : nm(a.i)}</td><td class="n">${a.i === c.me ? '' : fmtRel(a.gap_ms)}</td></tr>`; }).join(''));
    }});

  // ---------- stops made ----------
  Pit.module({type:'stops', title:'Pit stops', group:'Strategy', blurb:'Every stop measured: lane and box time, what it cost, fuel, tyres, and the stint after it.',
    size:{w:6, h:7, minW:4, minH:4}, needs:['summary'],
    build(el){ el.innerHTML = '<table class="tt"><thead><tr><th class="n">Lap</th><th class="n">Lane s</th><th class="n">Box s</th><th class="n">Loss s</th><th class="n">Fuel</th><th>Tyres</th><th class="n">Next stint</th></tr></thead><tbody></tbody></table>'; },
    render(c, inst){
      const stops = c.s && c.s.stops || []; if (!stops.length) return inst.setState('empty', 'No stops yet.');
      const sts = c.s.stints || [];
      setHtml(inst.body.querySelector('tbody'), stops.map((p, k) => { const n = sts.find(t => t.n === k + 2);
        return `<tr><td class="n">L${nf(p.lap, 0)}</td><td class="n">${nf(p.lane_ms / 1000, 1)}</td><td class="n">${nf(p.box_ms / 1000, 1)}</td><td class="n">${p.loss_ms != null ? nf(p.loss_ms / 1000, 1) : '<span class="note">after out-lap</span>'}</td><td class="n">${p.fuel_added_l > 0 ? '+' + nf(p.fuel_added_l, 1) : '—'}</td><td>${p.tyres ? `${nf(p.set_before, 0)}→${nf(p.set_after, 0)}` : 'no'}</td><td class="n">${n ? `${n.laps} L · ${fmtLap(n.best_ms)} · avg ${fmtLap(n.avg_ms)}` : '—'}</td></tr>`; }).join(''));
      inst.setInfo(`${stops.length} stop${stops.length > 1 ? 's' : ''}`);
    }});

  // ---------- weather ----------
  const compass = d => ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(((d % 360) + 360) % 360 / 45) % 8];
  Pit.module({type:'weather', title:'Track & weather', group:'Strategy', blurb:'Rain now and forecast, grip, track and air temperature trends, wind.',
    size:{w:4, h:5, minW:3, minH:5}, needs:['reading', 'field', 'tick'], requires:['reading'],
    build(el){ el.innerHTML = '<div class="wx-rain"></div><dl class="kv wx"></dl>'; },
    render(c, inst){
      const s = c.r.session, car = c.r.car, rain = Array.isArray(s.rain) ? s.rain : [], st = inst.state, t = Date.now();
      const H = st.h || (st.h = []);
      if (!H.length || t - H[H.length - 1].t >= 30000) { H.push({t, track:car.road_temp_c, air:car.air_temp_c}); while (H.length > 21) H.shift(); }   // 10 min, every 30 s
      const trend = k => { if (H.length < 2) return ''; const d = car[k === 'track' ? 'road_temp_c' : 'air_temp_c'] - H[0][k], mins = Math.round((t - H[0].t) / 60000);
        return Math.abs(d) < 0.5 ? ' <span class="note">steady</span>' : ` <span class="note">${d > 0 ? '▲ +' : '▼ ' + MINUS}${(Math.abs(d) * (un('temp').u === '°F' ? 1.8 : 1)).toFixed(1)}° in ${Math.max(1, mins)} min</span>`; };
      setHtml(inst.body.querySelector('.wx-rain'), [['Now', rain[0]], ['10 min', rain[1]], ['30 min', rain[2]]].map(([l, v]) => {
        const k = v | 0, w = k >= 3;
        return `<div class="wx-c"><div class="lbl">${l}</div><div class="${w ? 's-warn' : ''}">${esc(RAIN[k] || '—')}${w ? ' ▲' : ''}</div><span class="wx-lvl" aria-hidden="true">${[1, 2, 3, 4, 5].map(i => `<i class="${i <= k ? (w ? 'on w' : 'on') : ''}"></i>`).join('')}</span></div>`; }).join(''));
      const F = fieldOn(c) && c.field.weather;
      setHtml(inst.body.querySelector('.wx'), kvHtml([['Grip', `${esc(GRIP[s.track_grip] || '—')}${s.track_status ? ` <span class="note">${esc(s.track_status)}</span>` : ''}`],
        ['Track', `${fv('temp', car.road_temp_c, 1)}°${trend('track')}`], ['Air', `${fv('temp', car.air_temp_c, 1)}°${trend('air')}`],
        ['Wind', `${fvu('speed', s.wind_speed_kmh)} <svg class="wx-arrow" width="14" height="14" viewBox="-7 -7 14 14" aria-hidden="true"><path transform="rotate(${nf(s.wind_direction_deg, 0)})" d="M0 -6 L4 4 L0 2 L-4 4 Z"/></svg> ${nf(s.wind_direction_deg, 0)}° ${compass(s.wind_direction_deg || 0)}`],
        F && ['Clouds', `${nf(F.clouds * 100, 0)}<span class="u"> %</span>`], F && ['Wetness', `${nf(F.wet * 100, 0)}<span class="u"> %</span>`]]));
      inst.setAlert((rain[1] | 0) >= 3 && !c.wet ? 1 : 0);
    }});

  // ---------- pace (degradation) ----------
  const fit = pts => {   // least squares: [slope ms/lap, intercept]
    if (pts.length < 3) return null;
    const n = pts.length, mx = pts.reduce((a, p) => a + p[0], 0) / n, my = pts.reduce((a, p) => a + p[1], 0) / n;
    let sxy = 0, sxx = 0; for (const [x, y] of pts) { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; }
    const k = sxx ? sxy / sxx : 0; return [k, my - k * mx];
  };
  Pit.module({type:'degradation', title:'Pace', group:'Strategy', blurb:'This stint\'s lap times against a fitted line: what the tyres are costing per lap.',
    size:{w:6, h:7, minW:3, minH:5}, needs:['summary', 'laps'],
    options:[{key:'fuelCorr', label:'Fuel correction (s per 10 L)', type:'number', min:0, max:1, step:0.05, def:0}, {key:'compare', label:'Show the previous stint', type:'toggle', def:true}],
    build(el){ el.innerHTML = '<div class="sub dg-sub"></div><div class="dg-wrap"></div>'; },
    render(c, inst){
      const L = (c.laps || []).filter(l => l.ms > 0); if (!L.length) return inst.setState('empty', 'Lap times appear here after the first lap.');
      const sn = Math.max(...L.map(l => l.stint || 1)), o = inst.opts;
      const stintLaps = n => L.filter(l => (l.stint || 1) === n), cur = stintLaps(sn), prev = o.compare ? stintLaps(sn - 1) : [];
      const corr = laps => { const last = laps.length ? laps[laps.length - 1].fuel_end : null;
        return l => o.fuelCorr > 0 && l.fuel_end != null && last != null ? l.ms - o.fuelCorr * (l.fuel_end - last) / 10 * 1000 : l.ms; };
      const clean = l => l.valid && !l.out && !l.in, cc = corr(cur), pc = corr(prev);
      const pts = cur.filter(clean).map(l => [l.n, cc(l)]), f = fit(pts);
      const pf = fit(prev.filter(clean).map(l => [l.n - prev[0].n + cur[0].n, pc(l)]));   // the previous stint laid over this one, from the same start
      const wrap = inst.body.querySelector('.dg-wrap'), W = wrap.clientWidth, H = wrap.clientHeight;
      // fewer than 5 clean laps: the slope is shown, dim, but not judged (one out-lap or traffic lap moves it a lot)
      const slope = f ? f[0] : null, few = pts.length < 5, cls = slope == null || few ? 's-dim' : slope > 150 ? 's-bad' : slope > 60 ? 's-warn' : 's-ok';
      setHtml(inst.body.querySelector('.dg-sub'), `<span>${plural(pts.length, 'clean lap')} · stint ${sn}${o.fuelCorr > 0 ? ' · fuel-corrected' : ''}${slope != null ? ` · trend <b class="${cls}">${signed(slope / 1000, 3)} s/lap ${slope > 0 ? '▲' : '▼'}</b>${few ? ' <span class="note">(n=' + pts.length + ', judged from 5)</span>' : ''}` : ''}</span>`
        + (o.compare && prev.length ? `<span class="lg"><i class="sw dash" style="--c:var(--dim)"></i>stint ${sn - 1}</span>` : ''));
      inst.setInfo(`stint ${sn} · ${plural(pts.length, 'clean lap')}`);   // the trend is in the line under the header, once
      const key = JSON.stringify([W, H, cur.map(l => [l.n, l.ms, l.valid, l.out, l.in, l.fuel_end]), prev.length, o]);
      if (W < 60 || H < 40 || inst.state.k === key) return; inst.state.k = key;
      const vals = pts.length ? pts.map(p => p[1]) : cur.map(cc);
      let lo = Math.min(...vals) - 300, hi = Math.max(...vals) + 300; if (hi - lo < 1000) { const m = (hi + lo) / 2; lo = m - 500; hi = m + 500; }
      // one dot per lap at its time (a bar on a cut axis would exaggerate tenths); invalid, out and in laps hollow and named.
      // The y labels live in a 62 px gutter at the left, never over the data; the x axis runs two laps past the last one.
      const n0 = cur[0].n, n1 = Math.max(cur[cur.length - 1].n + 2, n0 + 4), gl = 62, top = 6, bot = H - 14, step0 = (W - gl - 6) / (n1 - n0 + 1);
      const X = n => gl + (n - n0 + .5) * step0, Y = v => bot - (bot - top) * clamp((v - lo) / (hi - lo), 0, 1);
      let g = '';
      const gs = [100, 200, 500, 1000, 2000, 5000].find(k => (hi - lo) / k <= 5) || 10000, ys = [];   // gridlines on round tenths of a second
      for (let v = Math.ceil(lo / gs) * gs; v <= hi; v += gs) { ys.push(v); const y = Y(v).toFixed(1); g += `<line class="dg-grid" x1="${gl}" y1="${y}" x2="${W}" y2="${y}"/>`; }
      const line = (F, cls, a, b, dash) => F ? `<line class="${cls}" x1="${X(a).toFixed(1)}" y1="${Y(F[0] * a + F[1]).toFixed(1)}" x2="${X(b).toFixed(1)}" y2="${Y(F[0] * b + F[1]).toFixed(1)}"${dash ? ' stroke-dasharray="4 3"' : ''}/>` : '';
      const p0 = pts.length ? pts[0][0] : n0, p1 = pts.length ? pts[pts.length - 1][0] : n0;   // the fit is solid over its laps, dashed where it is extrapolated
      g += line(pf, 'dg-prev', n0, n1) + line(f, 'dg-fit', p0, p1) + (p1 < n1 ? line(f, 'dg-fit', p1, n1, true) : '');
      for (const l of cur) {
        const v = cc(l), ok = clean(l), over = v > hi, cx = X(l.n).toFixed(1), cy = (over ? top + 3 : Y(v)).toFixed(1);
        g += `<circle class="dg-dot${ok ? '' : ' inv'}" cx="${cx}" cy="${cy}" r="3.5"><title>L${l.n} ${fmtLap(l.ms)}${l.valid ? '' : ' INV'}${l.out ? ' OUT' : ''}${l.in ? ' IN' : ''}</title></circle>`;
        if (over) g += `<text class="dg-ax" x="${cx}" y="${top + 14}" text-anchor="middle">▲</text>`;
        if (!ok) g += `<text class="dg-tag" x="${cx}" y="${(!f || +cy < Y(f[0] * l.n + f[1]) ? +cy - 7 : +cy + 13).toFixed(1)}" text-anchor="middle">${l.valid ? (l.out ? 'OUT' : 'IN') : 'INV'}</text>`;
      }
      const xs = Math.max(1, Math.ceil(28 / step0));
      for (let n = n0; n <= n1; n += xs) g += `<text class="dg-ax" x="${X(n).toFixed(1)}" y="${H - 2}" text-anchor="middle">${n}</text>`;
      for (const v of ys) g += `<text class="dg-ax" x="${gl - 6}" y="${(Y(v) + 3).toFixed(1)}" text-anchor="end">${fmtLap(v)}</text>`;
      wrap.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Lap times of stint ${sn} with a fitted line">${g}</svg>`;
    }});
})();
