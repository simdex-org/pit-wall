'use strict';
// mod-car.js (D2): track-map, car-status, lap-timer, tyres, tyre-history, brakes, electronics, damage, gg, channels.
// Everything here is the driver's own car from shared memory (ctx.r), plus the field on the map.
(() => {
  const stCls = s => s === 'ok' || s === 'none' ? '' : 's-' + s;

  // ---------- track map ----------
  const mapDraw = inst => { const c = Pit.ctx; if (!c || !c.r || !inst.state.cv) return null; const out = drawMap(inst.state.cv, inst.state.view, c, inst.opts); inst.state.hits = out.hits; syncFollow(inst); return out; };
  const syncFollow = inst => { const b = inst.el.querySelector('[data-tool="follow"]'); if (b) b.setAttribute('aria-pressed', !!inst.state.view.follow); };
  Pit.module({type:'track-map', title:'Track map', group:'Car', blurb:'Your racing lines lap over lap, the field on track, zoom, pan and follow.',
    size:{w:6, h:14, minW:3, minH:6}, linkable:true, needs:['reading', 'rec', 'field', 'entries', 'focus', 'sel'], requires:['reading'], rate:30,
    options:[
      {key:'field', label:'Show the field', type:'toggle', def:true},
      {key:'labels', label:'Car labels', type:'select', choices:[['none', 'None'], ['number', 'Race number'], ['short', 'Driver code']], def:'number'},
      {key:'lines', label:'Lap lines', type:'select', choices:[['all', 'Every recorded lap'], ['best', 'Best and current only']], def:'all'},
      {key:'colourBy', label:'Colour the line by', type:'select', choices:[['none', 'Nothing'], ['delta', 'Δ CMP vs REF (Analysis)']], def:'none'},
      {key:'follow', label:'Start following the car', type:'toggle', def:false},
    ],
    tools:[{id:'follow', icon:'crosshair', label:'Follow the car (F)'}, {id:'fit', icon:'maximize', label:'Whole track (Shift+F)'}],
    build(el, inst){
      el.innerHTML = '<div class="cv map"><canvas aria-label="Track map: racing lines and cars"></canvas></div>';
      const cv = el.querySelector('canvas'), view = inst.state.view = {zoom:inst.opts.follow ? 4 : 1, follow:inst.opts.follow, dx:0, dy:0};
      inst.state.cv = cv;
      bindMapControls(cv, view, () => mapDraw(inst), (x, y) => {   // a click within 10 px of a car makes it the focus car
        let best = null, d = 10; for (const h of inst.state.hits || []) { const e = Math.hypot(h.x - x, h.y - y); if (e <= d) { d = e; best = h; } }
        if (best) Pit.setFocus(best.i === Pit.ctx.me ? 'self' : best.i);
      });
    },
    tool(id, inst){
      const v = inst.state.view;
      if (id === 'follow') { v.follow = !v.follow; if (v.follow && v.zoom < 4) v.zoom = 4; }
      if (id === 'fit') { v.follow = false; v.zoom = 1; v.dx = v.dy = 0; }
      mapDraw(inst);
    },
    render(c, inst){
      const out = mapDraw(inst); if (!out) return;
      if (out.empty) return inst.setState('empty', 'No layout for this track yet: the map is drawn as the car laps it.');
      const fld = inst.opts.field && fieldOn(c);
      inst.setInfo(out.info + (fld && out.noField ? ' · Field positions appear after your first whole lap' : ''));   // the rival-data note lives in Standings
    }});

  // ---------- driver inputs ----------
  const meter = (k, cls, label) => `<div class="cs-m"><span class="lbl">${label}</span><div class="bar ${cls}"><i data-${k}></i></div><span class="n" data-${k}v></span></div>`;
  Pit.module({type:'car-status', title:'Driver inputs', group:'Car', blurb:'Gear, speed, RPM, pedals, steering and the car\'s state flags, live.',
    size:{w:3, h:7, minW:3, minH:4}, needs:['reading'], requires:['reading'], rate:30,
    build(el){
      el.innerHTML = `<div class="cs-top"><div><div class="lbl">Gear</div><div class="big xl" data-gear></div></div><div><div class="lbl">Speed</div><div class="big" data-speed></div></div><b class="cs-shift s-bad" hidden>SHIFT</b></div>
        ${meter('rpm', 'rpm', 'RPM')}${meter('thr', 'thr', 'Throttle')}${meter('brk', 'brk', 'Brake')}${meter('clu', 'clu', 'Clutch')}
        <div class="cs-m"><span class="lbl">Steer</span><div class="cs-steer"><i data-steer></i></div><span class="n" data-steerv></span></div><div class="cs-chips"></div>`;
    },
    render(c, inst){
      const a = c.r.car, s = c.r.session, b = inst.body, q = k => b.querySelector(`[data-${k}]`), max = c.r.fixed.max_rpm || REC.maxRpm || 8000, rp = clamp(a.rpm / max, 0, 1);
      const set = (k, t) => { const e = q(k); if (e.textContent !== t) e.textContent = t; };
      set('gear', a.gear < 0 ? 'R' : a.gear === 0 ? 'N' : String(a.gear));
      setHtml(q('speed'), fvu('speed', a.speed_kmh));
      for (const [k, v] of [['thr', a.throttle], ['brk', a.brake], ['clu', a.clutch]]) { q(k).style.width = clamp(v * 100, 0, 100) + '%'; set(k + 'v', (clamp(v, 0, 1) * 100).toFixed(0) + '%'); }
      q('rpm').style.width = rp * 100 + '%'; q('rpm').className = rp > .92 ? 's-bad' : rp > .8 ? 's-warn' : ''; set('rpmv', nf(a.rpm, 0));
      b.querySelector('.cs-shift').hidden = !(rp > .92);
      const st = clamp(a.steer_angle, -1, 1); q('steer').style.cssText = `left:${50 + Math.min(0, st) * 50}%;width:${Math.abs(st) * 50}%`; set('steerv', nf(a.steer_angle, 2));
      const chips = [[a.pit_limiter, 'gauge', 'LIMITER'], [s.in_pit_lane, 'square-parking', 'PIT LANE'], [s.in_pit_box, 'wrench', 'IN BOX'], [a.tc_in_action, 'activity', 'TC'], [a.abs_in_action, 'disc', 'ABS'],
        [a.tyres_off_track > 0, 'triangle-alert', `${a.tyres_off_track} WHEEL${a.tyres_off_track > 1 ? 'S' : ''} OFF`], [!s.lap_is_valid, 'x', 'INVALID LAP']].filter(x => x[0]);
      const ck = chips.map(x => x[2]).join();
      if (inst.state.ck !== ck) { inst.state.ck = ck; const box = b.querySelector('.cs-chips'); box.innerHTML = chips.map(([, ic, w]) => `<span class="chip ${/OFF|INVALID/.test(w) ? 'alert' : 'on'}"><i data-lucide="${ic}"></i>${w}</span>`).join(''); refreshIcons(box); }
    }});

  // ---------- lap timer ----------
  Pit.module({type:'lap-timer', title:'Lap', group:'Car', blurb:'The lap in progress, live delta, last, best and the game\'s estimate.',
    size:{w:3, h:5, minW:3, minH:4}, needs:['reading', 'summary'], requires:['reading'], rate:15,
    build(el){ el.innerHTML = '<div class="lbl" data-sec></div><div class="lt-top"><div class="big" data-cur></div><div class="lt-d" data-d></div></div><div class="sub lt-sub"></div>'; },
    render(c, inst){
      const s = c.r.session, a = c.r.car, b = inst.body, inv = !s.lap_is_valid, best = c.s && c.s.best_ms != null ? c.s.best_ms : okMs(s.best_lap_ms) ? s.best_lap_ms : null;
      b.dataset.loc = s.in_pit_lane ? 'pit' : inv ? 'invalid' : 'track';
      b.querySelector('[data-sec]').textContent = `Lap ${s.lap_number || '—'} · sector ${(s.current_sector | 0) + 1}/${c.r.fixed.sector_count || 3}`;
      setHtml(b.querySelector('[data-cur]'), inv ? `<span class="t-inv">${fmtLap(s.current_lap_ms)}</span> <b class="tag inv">INV</b>` : fmtLap(s.current_lap_ms));
      const d = a.reference_delta_s == null ? null : a.reference_delta_s * 1000;
      setHtml(b.querySelector('[data-d]'), `<span class="lbl">Δ live</span><b class="n">${deltaHtml(d)}</b>`);
      const sb = best != null && c.field && c.field.best && c.field.best.ms === best;
      setHtml(b.querySelector('.lt-sub'), `<span>Last <b class="n">${fmtLap(s.last_lap_ms)}</b></span><span>Best <b class="n">${best == null ? '—' : sb ? `<span class="t-best">◆ ${fmtLap(best)}</span>` : fmtLap(best)}</b></span><span>Est <b class="n">${fmtLap(s.estimated_lap_ms)}</b></span>`);
    }});

  // ---------- tyres: the car from above ----------
  // one tile per corner: core temperature, pressure and brake, each as a number and a position inside its window
  const gauge = (v, lo, hi, min, max, s) => { const pc = x => clamp((x - min) / (max - min) * 100, 0, 100).toFixed(1);
    return `<div class="tg"><i style="left:${pc(lo)}%;width:${(pc(hi) - pc(lo)).toFixed(1)}%"></i><b class="${stCls(s)}" style="left:${pc(v)}%"></b></div>`; };
  function tyreTiles(c, s, cap, ctx, brakes){
    const [tlo, thi] = th(ctx).tyre_c, [plo, phi] = psiWindow(ctx), wet = !!s.rain_tyres;
    const tile = i => {
      const front = i < 2, core = coreT(c, i, cap), p = c.tyre_pressure_psi[i], bt = c.brake_temp_c[i], [blo, bhi] = (th(ctx).brake_c[front ? 'front' : 'rear'] || th(ctx).brake_c.front);
      const ts = tyreState(core, ctx), ps = pressState(p, ctx), bs = brakeState(bt, front ? 'front' : 'rear', ctx), w = [ts, ps, bs].includes('bad') ? 'bad' : [ts, ps, bs].includes('warn') ? 'warn' : [ts, ps, bs].includes('cold') ? 'cold' : 'ok';
      const word = [ts, ps, bs].map(x => STATE_WORD[x]).find(Boolean) || '';
      return `<div class="tz-c ${stCls(w)}"><div class="tz-h"><b>${CORNERS[i]}</b><span class="tz-w">${word}</span></div>
        <div class="tz-v ${stCls(ts)}">${fv('temp', core)}<span class="u">${un('temp').u}</span><i>${stateGlyph(ts)}</i></div>${gauge(core, tlo, thi, Math.max(0, tlo - 30), thi + 30, ts)}
        <div class="tz-r"><span>Pressure</span><b class="${stCls(ps)}">${fv('press', p)}${stateGlyph(ps)} <span class="u">${un('press').u}</span></b></div>${gauge(p, plo, phi, plo - 2, phi + 2.5, ps)}
        ${brakes ? `<div class="tz-br"><div class="tz-r"><span>Brake</span><b class="${stCls(bs)}">${fv('temp', bt)}${stateGlyph(bs)} <span class="u">${un('temp').u}</span></b></div>${gauge(bt, blo, bhi - 100, 0, bhi + 150, bs)}</div>` : ''}</div>`;
    };
    return `<div class="tz-bar"><span class="tz-comp${wet ? ' wet' : ''}">${wet ? 'WET' : 'DRY'}</span><span>Set ${esc(s.tyre_set || '—')}</span></div><div class="tz-grid">${[0, 1, 2, 3].map(tile).join('')}</div>`;
  }
  const worst = ss => ss.includes('bad') ? 2 : ss.some(s => s === 'warn' || s === 'cold') ? 1 : 0;
  Pit.module({type:'tyres', title:'Tyres', group:'Car', blurb:'Pressures, core temperatures and brakes on a car seen from above, and the next stop\'s correction.',
    size:{w:4, h:12, minW:3, minH:6}, needs:['reading', 'summary', 'config'], requires:['reading'], rate:5,
    options:[{key:'corrections', label:'Show the next stop\'s correction', type:'toggle', def:true}, {key:'brakes', label:'Show brakes', type:'toggle', def:true}],
    build(el){ el.innerHTML = '<div class="tz"></div><table class="tt ty-t"><thead><tr><th></th>' + CORNERS.map(x => `<th class="n">${x}</th>`).join('') + '</tr></thead><tbody></tbody></table><p class="note">ACC publishes core temperature only (no inner, middle or outer) and no tyre wear: Pace shows what the tyres cost in lap time.</p>'; },
    render(c, inst){
      const r = c.r, a = r.car, o = inst.opts, pl = c.s && c.s.press_line, cap = r.capabilities || {};
      const k = JSON.stringify([a.tyre_pressure_psi.map(v => v.toFixed(1)), a.tyre_core_temp_c.map(Math.round), a.brake_temp_c.map(v => Math.round(v / 5)), r.session.tyre_set, c.wet, Pit.prefs.units, c.th, o.brakes]);
      if (inst.state.k !== k) { inst.state.k = k; inst.body.firstChild.innerHTML = tyreTiles(a, r.session, cap, c, o.brakes); }
      const [lo, hi] = psiWindow(c), mid = (lo + hi) / 2, cell = (v, s) => `<td class="n ${stCls(s)}">${v}${stateGlyph(s)}${s === 'cold' && v !== '—' ? ' <span class="note">COLD</span>' : ''}</td>`;
      const ps = a.tyre_pressure_psi.map(p => pressState(p, c)), ts = [0, 1, 2, 3].map(i => tyreState(coreT(a, i, cap), c)), bs = a.brake_temp_c.map((t, i) => brakeState(t, i < 2 ? 'front' : 'rear', c));
      const rows = [pl && ['Avg at line', pl.psi.map(p => cell(fv('press', p), pressState(p, c)))],
        o.corrections && pl && ['Next stop', pl.psi.map(p => { const d = mid - p, x = un('press').f(d) - un('press').f(0); return `<td class="n">${Math.abs(d) < 0.05 ? '0' : (d > 0 ? '▲ +' : '▼ ' + MINUS) + Math.abs(x).toFixed(un('press').d)}</td>`; })]].filter(Boolean);
      setHtml(inst.body.querySelector('tbody'), rows.map(([l, v]) => `<tr><td>${l}</td>${v.join('')}</tr>`).join(''));
      inst.body.querySelector('.ty-t').hidden = !rows.length;
      inst.setInfo(`stint ${c.s ? plural(c.s.stint_laps, 'lap') : '—'} · window ${fv('press', lo)}–${fv('press', hi)} ${un('press').u} (${r.fixed.car_class || 'GT3'} ${c.wet ? 'wet' : 'dry'})`);
      inst.setAlert(worst(ps.concat(ts, o.brakes ? bs : [])));   // one alert per module: the tab badge counts problems, not corners
    }});

  // ---------- tyre history ----------
  Pit.module({type:'tyre-history', title:'Tyre history', group:'Car', blurb:'Pressures and core temperatures at the line, lap by lap.',
    size:{w:8, h:11, minW:4, minH:6}, needs:['laps', 'units', 'config'],
    build(el){ el.innerHTML = '<table class="tt th"><thead></thead><tbody></tbody></table>'; },
    render(c, inst){
      const L = (c.laps || []).filter(l => Array.isArray(l.psi)); if (!L.length) return inst.setState('empty', 'Filled as laps are completed.');
      setHtml(inst.body.querySelector('thead'), `<tr><th class="n">Lap</th><th class="n">Set</th>${CORNERS.map(x => `<th class="n">${x} ${un('press').u}</th>`).join('')}${CORNERS.map(x => `<th class="n">${x} ${un('temp').u}</th>`).join('')}<th class="n">Track ${un('temp').u}</th></tr>`);
      setHtml(inst.body.querySelector('tbody'), L.slice().reverse().map(l => { const cx = {th:c.th, wet:l.wet};
        return `<tr><td class="n">${l.n}</td><td class="n">${l.wet ? 'W' : 'D'}${nf(l.set, 0)}</td>${l.psi.map(p => { const s = pressState(p, cx); return `<td class="n ${stCls(s)}">${fv('press', p)}${stateGlyph(s)}</td>`; }).join('')}`
          + `${(l.core || []).map(t => { const s = tyreState(t, cx); return `<td class="n ${stCls(s)}">${fv('temp', t)}${stateGlyph(s)}</td>`; }).join('')}<td class="n">${fv('temp', l.track_c, 1)}</td></tr>`; }).join(''));
      inst.setInfo(`${plural(L.length, 'lap')} · ${un('press').u}, ${un('temp').u}`);
    }});

  // ---------- brakes ----------
  Pit.module({type:'brakes', title:'Brakes', group:'Car', blurb:'Pad and disc thickness, wear per lap, laps left on the pads, and temperatures.',
    size:{w:4, h:6, minW:3, minH:5}, needs:['reading', 'summary', 'config'], requires:['reading'],
    build(el){ el.innerHTML = '<table class="tt br"><thead><tr><th></th>' + CORNERS.map(x => `<th class="n">${x}</th>`).join('') + '</tr></thead><tbody></tbody></table>'; },
    render(c, inst){
      const a = c.r.car, stint = c.s && c.s.stint || [], first = stint.length ? stint[0].pads : null, last = stint.length ? stint[stint.length - 1].pads : null, low = th(c).pad_low_mm;
      const wear = i => first && last && stint.length > 1 ? (first[i] - last[i]) / (stint.length - 1) : null;
      // pad mm with its bar as an underline (tick = pads low), so the table needs no unlabelled gauge row
      const rows = [['Pad mm', a.brake_pad_mm.map((v, i) => { const s = padState(v, c), sc = Math.max(30, first ? first[i] : v);
          return `<span class="${stCls(s)}">${nf(v, 1)}${stateGlyph(s)}</span><div class="gauge"><i class="${stCls(s)}" style="width:${clamp(v / sc * 100, 0, 100).toFixed(1)}%"></i><b style="left:${clamp(low / sc * 100, 0, 100).toFixed(1)}%" title="${low} mm: pads low"></b></div>`; }), 'pad'],
        ['Wear / lap', a.brake_pad_mm.map((v, i) => { const w = wear(i); return w == null ? '—' : nf(w, 3); })],
        ['Laps left', a.brake_pad_mm.map((v, i) => { const w = wear(i); return w > 0.0005 ? nf(Math.max(0, (v - low) / w), 0) : '—'; })],
        ['Disc mm', a.brake_disc_mm.map(v => nf(v, 1))],
        [`Temp ${un('temp').u}`, a.brake_temp_c.map((t, i) => { const s = brakeState(t, i < 2 ? 'front' : 'rear', c); return `<span class="${stCls(s)}">${fv('temp', t)}${stateGlyph(s)}</span>`; })]];
      setHtml(inst.body.querySelector('tbody'), rows.map(([l, v, cls]) => `<tr><td>${l}</td>${v.map(x => `<td class="n${cls ? ' ' + cls : ''}">${x}</td>`).join('')}</tr>`).join(''));
      inst.setInfo(`pads F ${nf(a.front_pad_compound, 0)} · R ${nf(a.rear_pad_compound, 0)}${stint.length > 1 ? ` · over ${stint.length} laps` : ''}`);
      inst.setAlert(Math.max(...a.brake_pad_mm.map(v => padState(v, c) === 'bad' ? 2 : 0), ...a.brake_temp_c.map((t, i) => { const s = brakeState(t, i < 2 ? 'front' : 'rear', c); return s === 'bad' ? 2 : s === 'warn' ? 1 : 0; })));
    }});

  // ---------- electronics ----------
  Pit.module({type:'electronics', title:'Electronics', group:'Car', blurb:'Brake bias, TC, ABS, engine map, lights and wipers.',
    size:{w:4, h:5, minW:3, minH:4}, needs:['reading'], requires:['reading'],
    build(el){ el.innerHTML = '<dl class="kv cols2"></dl>'; },
    render(c, inst){
      const a = c.r.car, s = c.r.session;
      setHtml(inst.body.firstChild, kvHtml([['Brake bias', a.brake_bias != null ? `${nf(a.brake_bias, 1)}<span class="u"> %</span>` : '—'], ['TC', nf(a.tc_level, 0)], ['TC cut', nf(s.tc_cut, 0)], ['ABS', nf(a.abs_level, 0)],
        ['Engine map', nf(s.engine_map, 0)], ['Rain lights', a.rain_lights ? 'on' : 'off'], ['Lights', ['off', 'low', 'high'][a.lights_stage | 0] || '—'], ['Wiper', nf(a.wiper, 0)]]));
    }});

  // ---------- damage & engine ----------
  const ZONES = ['Front', 'Rear', 'Left', 'Right', 'Centre'];
  Pit.module({type:'damage', title:'Damage & engine', group:'Car', blurb:'Bodywork and suspension damage, water and exhaust temperature.',
    size:{w:4, h:6, minW:3, minH:5}, needs:['reading', 'config'], requires:['reading'],
    build(el){ el.innerHTML = '<div class="dm-ok"></div><div class="dm-cols"><dl class="kv dm-body"></dl><dl class="kv dm-sus"></dl></div>'; },
    render(c, inst){
      const a = c.r.car, dmg = (a.damage || []).slice(0, 5), sus = a.suspension_damage || [], any = dmg.some(v => v > 0) || sus.some(v => v > 0), ws = waterState(a.water_temp_c, c);
      const ok = inst.body.querySelector('.dm-ok');
      if (ok.dataset.any !== String(any)) { ok.dataset.any = String(any); ok.innerHTML = any ? '<span class="s-bad"><i data-lucide="octagon-alert"></i><b>Damage</b> <span class="note">level (0 = none)</span></span>' : '<span class="s-ok"><i data-lucide="circle-check"></i><b>No damage</b></span>'; refreshIcons(ok); }
      // no damage: only the engine rows, not nine zeros repeating the headline
      setHtml(inst.body.querySelector('.dm-body'), kvHtml([...(any ? ZONES.map((z, i) => [z, nf(dmg[i], 1), dmg[i] > 0 ? 's-bad' : '']) : []), ['Water', `${fv('temp', a.water_temp_c)}<span class="u"> ${un('temp').u}</span>${stateGlyph(ws)}`, stCls(ws)]]));
      setHtml(inst.body.querySelector('.dm-sus'), kvHtml([...(any ? CORNERS.map((z, i) => [`Susp. ${z}`, nf(sus[i], 2), sus[i] > 0 ? 's-bad' : '']) : []), ['Exhaust', `${fv('temp', a.exhaust_temp_c)}<span class="u"> ${un('temp').u}</span>`]]));
      inst.setAlert(any || ws === 'bad' ? 2 : ws === 'warn' ? 1 : 0);
    }});

  // ---------- G-G ----------
  Pit.module({type:'gg', title:'G-G', group:'Car', blurb:'Lateral against longitudinal G over the last seconds: the friction circle.',
    size:{w:3, h:7, minW:3, minH:5}, needs:['reading'], rate:30,
    build(el){ el.innerHTML = '<div class="cv"><canvas aria-label="G-G plot"></canvas></div>'; },
    render(c, inst){
      drawGG(inst.body.querySelector('canvas'), {T:REC.frozen || REC.trace, trail:5 * Pit.prefs.hz});
      inst.setInfo(`max lat ${REC.gHist.maxLat.toFixed(2)} · long ${REC.gHist.maxLon.toFixed(2)} g`);
    }});

  // ---------- live channels ----------
  const pauseNow = () => { setPaused(!REC.frozen); Pit.emit('pause', !!REC.frozen); Pit.dirty('rec'); };
  Pit.module({type:'channels', title:'Live channels', group:'Car', blurb:'Rolling traces of speed, pedals, steering, gear and more; hover to read values.',
    size:{w:6, h:8, minW:4, minH:5}, needs:['reading', 'rec'], rate:30,
    options:[{key:'rows', label:'Rows', type:'multi', choices:Object.entries(ROWDEFS).map(([k, d]) => [k, d.label]), def:['speed', 'pedals', 'steer', 'gearrpm']},
      {key:'window', label:'Window', type:'select', choices:[['20', '20 s'], ['30', '30 s'], ['60', '60 s']], def:'30'}],
    tools:[{id:'pause', icon:'pause', label:'Pause or resume (P)'}],
    build(el, inst){
      el.innerHTML = '<div class="cv"><canvas aria-label="Live channels"></canvas></div>';
      const cv = el.querySelector('canvas');
      cv.addEventListener('pointermove', e => { const b = cv.getBoundingClientRect(), win = inst.opts.window * Pit.prefs.hz; inst.state.hover = Math.round((1 - (e.clientX - b.left) / b.width) * (win - 1)); inst.def.render(Pit.ctx, inst); });
      cv.addEventListener('pointerleave', () => { inst.state.hover = null; inst.def.render(Pit.ctx, inst); });
    },
    tool(id){ if (id === 'pause') pauseNow(); },
    render(c, inst){
      const rows = inst.opts.rows.filter(k => ROWDEFS[k]); if (!rows.length) return inst.setState('empty', 'No channels chosen: pick some in the options.');
      const win = Math.min(TRACE_N, +inst.opts.window * Pit.prefs.hz), h = inst.state.hover;
      const rg = drawLive(inst.body.querySelector('canvas'), rows, REC.frozen || REC.trace, h, {win});
      const s = rg && rg.s, nm = s && (typeof s.name === 'function' ? s.name() : s.name);
      inst.setInfo([`${inst.opts.window} s`, rg ? `${ROWDEFS[rows[0]].label.toLowerCase()} ${nm} ${s.fmt(rg.lo)}–${s.fmt(rg.hi)}` : '', h != null ? `${(h / Pit.prefs.hz).toFixed(1)} s ago` : '', REC.frozen ? 'paused' : ''].filter(Boolean).join(' · '));
      const b = inst.el.querySelector('[data-tool="pause"]'), ic = REC.frozen ? 'play' : 'pause';
      if (b && b.dataset.ic !== ic) { b.dataset.ic = ic; b.setAttribute('aria-pressed', !!REC.frozen); b.innerHTML = `<i data-lucide="${ic}"></i>`; refreshIcons(b); }
    }});
})();
