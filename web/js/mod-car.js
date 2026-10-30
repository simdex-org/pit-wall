'use strict';
// mod-car.js (D2): track-map, car-status, lap-timer, tyres, tyre-history, brakes, electronics, damage, gg, channels.
// Everything here is the driver's own car from shared memory (ctx.r), plus the field on the map.
(() => {
  const stCls = s => s === 'ok' || s === 'none' ? '' : 's-' + s;

  // ---------- track map ----------
  const mapDraw = inst => { const c = Pit.ctx; if (!c || !c.r || !inst.state.cv) return null; const out = drawMap(inst.state.cv, inst.state.view, c, inst.opts); inst.state.hits = out.hits; syncFollow(inst); return out; };
  const syncFollow = inst => { const b = inst.el.querySelector('[data-tool="follow"]'); if (b) b.setAttribute('aria-pressed', !!inst.state.view.follow); };
  Pit.module({type:'track-map', title:'Track map', group:'Car', blurb:'Your car and the field on the track, zoom, pan and follow.',
    size:{w:6, h:14, minW:3, minH:6}, linkable:true, needs:['reading', 'field', 'entries', 'focus'], requires:['reading'], rate:60,
    options:[
      {key:'field', label:'Show the field', type:'toggle', def:true},
      {key:'labels', label:'Car labels', type:'select', choices:[['gap', 'Gap to you'], ['none', 'None (dots only)'], ['number', 'Race number'], ['short', 'Driver code'], ['name', 'Driver surname'], ['both', 'Number and code']], def:'gap'},
      {key:'size', label:'Size of cars and labels', type:'select', choices:[['s', 'Small'], ['m', 'Medium'], ['l', 'Large']], def:'m'},
      {key:'corners', label:'Turn names (on the drawn layout)', type:'toggle', def:true},
      {key:'follow', label:'Start following the car', type:'toggle', def:false},
    ],
    tools:[{id:'follow', icon:'crosshair', label:'Follow the car (F)'}, {id:'fit', icon:'maximize', label:'Whole track (Shift+F)'}],
    build(el, inst){
      el.innerHTML = '<div class="cv map"><canvas aria-label="Track map: your car and the field"></canvas></div>';
      const cv = el.querySelector('canvas'), view = inst.state.view = {zoom:inst.opts.follow ? 4 : 1, follow:inst.opts.follow, dx:0, dy:0};
      inst.state.cv = cv;
      // the feed arrives in bursts, so the map paints on every animation frame: the dots glide at the screen's rate, not the feed's
      const tick = () => { if (inst.state.dead) return; if (cv.isConnected) inst.state.out = mapDraw(inst); inst.state.raf = requestAnimationFrame(tick); };
      inst.state.raf = requestAnimationFrame(tick);
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
    destroy(inst){ inst.state.dead = true; cancelAnimationFrame(inst.state.raf); },
    render(c, inst){
      const out = inst.state.out || mapDraw(inst); if (!out) return;
      if (out.empty) return inst.setState('empty', 'No layout for this track.');
      inst.setInfo(out.info);
    }});

  // ---------- driver inputs ----------
  const meter = (k, cls, label) => `<div class="cs-m"><span class="lbl">${label}</span><div class="bar ${cls}"><i data-${k}></i></div><span class="n" data-${k}v></span></div>`;
  Pit.module({type:'car-status', title:'Driver inputs', group:'Car', blurb:'Gear, speed, RPM, pedals, steering and the car\'s state flags, live.',
    size:{w:3, h:7, minW:3, minH:4}, needs:['reading'], requires:['reading'], rate:60,
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
  // GT3 from above, nose up. Zones are rects clipped to the silhouette; corners are the tyres (suspension damage).
  const BODY = 'M120 22C142 22 152 28 158 44C164 58 168 74 168 96C168 118 160 130 158 150C158 170 168 190 170 220C172 250 168 280 160 300C154 312 142 316 120 316C98 316 86 312 80 300C72 280 68 250 70 220C72 190 82 170 82 150C80 130 72 118 72 96C72 74 76 58 82 44C88 28 98 22 120 22Z';
  const SPLIT = 'M72 16Q120 6 168 16L164 26Q120 20 76 26Z', WING = 'M60 316H180V332H60Z';
  const zone = (i, x, y, w, h, tx, ty, an) => `<g data-z="${i}"><rect class="dz" x="${x}" y="${y}" width="${w}" height="${h}" clip-path="url(#dm-clip)"/><text x="${tx}" y="${ty}" text-anchor="${an}">0</text><text class="cn" x="${tx}" y="${ty + 12}" text-anchor="${an}">${ZONES[i].toUpperCase()}</text></g>`;
  const wheel = (i, x, y, h, tx, an) => `<g data-s="${i}"><rect class="dm-t" x="${x}" y="${y}" width="22" height="${h}" rx="6"/><rect class="dz" x="${x}" y="${y}" width="22" height="${h}" rx="6"/><text x="${tx}" y="${y + h / 2 - 2}" text-anchor="${an}">0</text><text class="cn" x="${tx}" y="${y + h / 2 + 10}" text-anchor="${an}">${CORNERS[i]}</text></g>`;
  const DM_CAR = `<div class="dm-car" hidden><svg viewBox="0 0 240 340" role="img" aria-label="Car damage by zone">
    <defs><clipPath id="dm-clip"><path d="${BODY}"/><path d="${SPLIT}"/><path d="${WING}"/></clipPath></defs>
    ${wheel(0, 56, 62, 46, 50, 'end')}${wheel(1, 162, 62, 46, 190, 'start')}${wheel(2, 56, 222, 52, 50, 'end')}${wheel(3, 162, 222, 52, 190, 'start')}
    <path class="dm-b" d="${BODY}"/><path class="dm-b" d="${SPLIT}"/><path class="dm-b" d="${WING}"/>
    ${zone(0, 0, 0, 240, 125, 120, 98, 'middle')}${zone(1, 0, 214, 240, 126, 120, 262, 'middle')}${zone(2, 0, 125, 98, 89, 74, 170, 'end')}${zone(3, 142, 125, 98, 89, 166, 170, 'start')}${zone(4, 98, 125, 44, 89, 120, 174, 'middle')}
    <g class="dm-d"><path d="M102 130H138L144 156H96ZM98 156H142V196H98ZM98 196H142L137 214H103Z"/>
      <path d="M98 54L114 62M142 54L126 62M120 30V70"/><path d="M92 37L106 32M148 37L134 32"/><path d="M90 306L106 308M150 306L134 308"/>
      <path d="M78 56C74 70 74 90 78 106M162 56C166 70 166 90 162 106M74 226C76 250 74 272 80 292M166 226C164 250 166 272 160 292"/>
      <ellipse cx="78" cy="134" rx="6" ry="3.5"/><ellipse cx="162" cy="134" rx="6" ry="3.5"/><path d="M60 316V332M180 316V332"/></g>
  </svg><div class="dm-chips"><span><i data-lucide="droplets"></i>Water <b class="dm-w n"></b></span><span><i data-lucide="flame"></i>Exhaust <b class="dm-x n"></b></span></div></div>`;
  Pit.module({type:'damage', title:'Damage & engine', group:'Car', blurb:'Bodywork and suspension damage, water and exhaust temperature.',
    size:{w:4, h:6, minW:3, minH:5}, needs:['reading', 'config'], requires:['reading'],
    options:[{key:'view', label:'View', type:'select', choices:[['table', 'Table'], ['car', 'Car drawing']], def:'table'}],
    build(el){ el.innerHTML = '<div class="dm-ok"></div><div class="dm-cols"><dl class="kv dm-body"></dl><dl class="kv dm-sus"></dl></div>' + DM_CAR; refreshIcons(el); },
    render(c, inst){
      const a = c.r.car, dmg = (a.damage || []).slice(0, 5), sus = a.suspension_damage || [], any = dmg.some(v => v > 0) || sus.some(v => v > 0), ws = waterState(a.water_temp_c, c);
      const carView = inst.opts.view === 'car', ok = inst.body.querySelector('.dm-ok'), cols = inst.body.querySelector('.dm-cols'), dc = inst.body.querySelector('.dm-car');
      cols.hidden = carView; dc.hidden = !carView;
      if (carView) {
        const paint = (sel, v, d) => { const e = dc.querySelector(sel); e.querySelector('text').textContent = nf(v, d); e.classList.toggle('s-bad', v > 0);
          const f = e.querySelector('.dz'); if (f) f.style.fillOpacity = v > 0 ? (.3 + .5 * Math.min(v / 100, 1)).toFixed(2) : 0; };
        ZONES.forEach((z, i) => paint(`[data-z="${i}"]`, dmg[i] || 0, 1));
        CORNERS.forEach((z, i) => paint(`[data-s="${i}"]`, sus[i] || 0, 2));
        setHtml(dc.querySelector('.dm-w'), `<span class="${stCls(ws)}">${fv('temp', a.water_temp_c)}${stateGlyph(ws)}</span><span class="u"> ${un('temp').u}</span>`);
        setHtml(dc.querySelector('.dm-x'), `${fv('temp', a.exhaust_temp_c)}<span class="u"> ${un('temp').u}</span>`);
      }
      ok.hidden = carView && !any;
      if (ok.dataset.any !== String(any)) { ok.dataset.any = String(any); ok.innerHTML = any ? '<span class="s-bad"><i data-lucide="octagon-alert"></i><b>Damage</b> <span class="note">level (0 = none)</span></span>' : '<span class="s-ok"><i data-lucide="circle-check"></i><b>No damage</b></span>'; refreshIcons(ok); }
      // no damage: only the engine rows, not nine zeros repeating the headline
      setHtml(inst.body.querySelector('.dm-body'), kvHtml([...(any ? ZONES.map((z, i) => [z, nf(dmg[i], 1), dmg[i] > 0 ? 's-bad' : '']) : []), ['Water', `${fv('temp', a.water_temp_c)}<span class="u"> ${un('temp').u}</span>${stateGlyph(ws)}`, stCls(ws)]]));
      setHtml(inst.body.querySelector('.dm-sus'), kvHtml([...(any ? CORNERS.map((z, i) => [`Susp. ${z}`, nf(sus[i], 2), sus[i] > 0 ? 's-bad' : '']) : []), ['Exhaust', `${fv('temp', a.exhaust_temp_c)}<span class="u"> ${un('temp').u}</span>`]]));
      inst.setAlert(any || ws === 'bad' ? 2 : ws === 'warn' ? 1 : 0);
    }});

  // ---------- damage in 3D: a GT3 painted green to red by what ACC reports, turned by dragging or by the view buttons ----------
  const C3_VIEWS = [['iso', '3D'], ['top', 'Top'], ['front', 'Front'], ['rear', 'Rear'], ['left', 'Left'], ['right', 'Right']];
  const c3Draw = inst => {
    const st = inst.state, c = Pit.ctx; if (!st.lv || !c || !c.r) return;
    const at = drawCar3d(st.cv, st.view, st.lv), g = st.cv.getContext('2d'), tk = Pit.tokens(), w = st.cv.clientWidth;
    if (!inst.opts.labels) return;
    g.font = `600 11px ${tk.num}`; g.textBaseline = 'middle';
    for (const [part, text] of st.tags) {   // the figure next to its part; parts on the far side of the car keep quiet
      const [x, y, faces] = at[part]; if (!faces) continue;
      const lv = st.lv[part], tw = g.measureText(text).width, bx = Math.max(2, Math.min(w - tw - 12, x - tw / 2 - 5));
      g.globalAlpha = .88; g.fillStyle = tk.bg; g.fillRect(bx, y - 9, tw + 10, 18); g.globalAlpha = 1;
      g.strokeStyle = lv == null ? tk.line : `rgb(${levelColour(lv, tk).map(Math.round).join(',')})`; g.lineWidth = 1; g.strokeRect(bx + .5, y - 8.5, tw + 9, 17);
      g.fillStyle = tk.text; g.fillText(text, bx + 5, y);
    }
  };
  const c3Turn = (inst, to) => {   // ease the camera to a view, the short way round
    const v = inst.state.view, [az1, el1] = CAR3D.VIEWS[to], az0 = v.az, el0 = v.el, daz = Math.atan2(Math.sin(az1 - az0), Math.cos(az1 - az0)), t0 = performance.now();
    const step = now => { const k = Math.min(1, (now - t0) / 350), e = k * (2 - k); v.az = az0 + daz * e; v.el = el0 + (el1 - el0) * e; c3Draw(inst); if (k < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  };
  Pit.module({type:'car-3d', title:'Car damage 3D', group:'Car', blurb:'A GT3 painted green to red by ACC\'s damage: five body zones, suspension per corner and brake pads. Drag to turn it.',
    size:{w:8, h:14, minW:4, minH:8}, needs:['reading', 'config', 'theme', 'resize'], requires:['reading'], rate:10,
    options:[
      {key:'bodyRed', label:'Bodywork is red at', type:'select', choices:[['50', '50'], ['100', '100'], ['200', '200']], def:'100'},
      {key:'susRed', label:'Suspension is red at', type:'select', choices:[['0.1', '0.10'], ['0.3', '0.30'], ['1', '1.00']], def:'0.3'},
      {key:'labels', label:'Show the figures on the car', type:'toggle', def:true}],
    build(el, inst){
      el.innerHTML = `<div class="c3-bar">${C3_VIEWS.map(([k, t]) => `<button class="btn" data-v="${k}">${t}</button>`).join('')}
        <button class="btn" data-x aria-pressed="false" title="See the suspension and steering through the bodywork">See-through</button></div>
        <div class="cv c3"><canvas aria-label="Car damage in 3D: drag to turn the car"></canvas></div>
        <div class="c3-key"></div>
        <p class="note c3-na">ACC reports bodywork damage in five zones (front, rear, left, right, centre), suspension damage per corner and brake pad
        thickness: those are painted. It does not report the glass, the steering, the engine, the wing on its own, or tyre wear, so those
        stay grey; the wing, splitter and diffuser take their zone's colour.</p>`;
      const cv = inst.state.cv = el.querySelector('canvas'), v = inst.state.view = {az:CAR3D.VIEWS.iso[0], el:CAR3D.VIEWS.iso[1], x:false};
      let drag = null;
      cv.addEventListener('pointerdown', e => { drag = [e.clientX, e.clientY, v.az, v.el]; cv.setPointerCapture(e.pointerId); });
      cv.addEventListener('pointermove', e => { if (!drag) return; v.az = drag[2] - (e.clientX - drag[0]) * .01; v.el = clamp(drag[3] + (e.clientY - drag[1]) * .01, -.15, 1.5707); c3Draw(inst); });
      cv.addEventListener('pointerup', () => { drag = null; });
      el.querySelectorAll('[data-v]').forEach(b => b.addEventListener('click', () => c3Turn(inst, b.dataset.v)));
      const xb = el.querySelector('[data-x]');
      xb.addEventListener('click', () => { v.x = !v.x; xb.setAttribute('aria-pressed', v.x); c3Draw(inst); });
    },
    render(c, inst){
      const a = c.r.car, dmg = a.damage || [], sus = a.suspension_damage || [], pads = a.brake_pad_mm || [], low = th(c).pad_low_mm;
      const br = +inst.opts.bodyRed || 100, sr = +inst.opts.susRed || .3, num = v => typeof v === 'number' && isFinite(v);
      const lv = inst.state.lv = {}, tags = inst.state.tags = [];
      ['front', 'rear', 'left', 'right', 'centre'].forEach((z, i) => { lv[z] = num(dmg[i]) ? dmg[i] / br : null; tags.push([z, `${ZONES[i].toUpperCase()} ${num(dmg[i]) ? nf(dmg[i], 1) : '—'}`]); });
      CORNERS.forEach((k, i) => {
        lv['s' + i] = num(sus[i]) ? sus[i] / sr : null;
        lv['b' + i] = pads[i] > 0 ? (low + 6 - pads[i]) / 6 : null;   // green 6 mm above the pads-low line, red on it
        tags.push(['s' + i, `${k} susp ${num(sus[i]) ? nf(sus[i], 2) : '—'} · pads ${pads[i] > 0 ? nf(pads[i], 1) : '—'} mm`]);
      });
      c3Draw(inst);
      const key = `${br}|${sr}|${low}`;
      if (inst.state.key !== key) {   // the scale: five steps from none to red, each with its figure (no gradients)
        inst.state.key = key; const tk = Pit.tokens(), sw = t => `<i style="background:rgb(${levelColour(t, tk).map(Math.round).join(',')})"></i>`;
        inst.body.querySelector('.c3-key').innerHTML = [['Bodywork', [0, br / 4, br / 2, br * .75, br].map(v => nf(v, 0))], ['Suspension', [0, sr / 4, sr / 2, sr * .75, sr].map(v => nf(v, 2))],
          ['Pads mm', [low + 6, low + 4.5, low + 3, low + 1.5, low].map(v => nf(v, 1))]].map(([t, vs]) =>
          `<span class="c3-row"><b>${t}</b>${vs.map((v, i) => `<span>${sw(i / 4)}${v}</span>`).join('')}</span>`).join('') + '<span class="c3-row"><b>Grey</b><span>no data from ACC</span></span>';
      }
      const worst = Math.max(0, ...['front', 'rear', 'left', 'right', 'centre', 's0', 's1', 's2', 's3'].map(k => lv[k] || 0));
      inst.setInfo(worst > 0 ? `worst ${Math.round(Math.min(worst, 9.99) * 100)} % of red · drag to turn` : 'no damage · drag to turn');
      inst.setAlert(dmg.some(v => v > 0) || sus.some(v => v > 0) ? 2 : 0);
    }});

  // ---------- G-G ----------
  Pit.module({type:'gg', title:'G-G', group:'Car', blurb:'Lateral against longitudinal G over the last seconds: the friction circle.',
    size:{w:3, h:7, minW:3, minH:5}, needs:['reading'], rate:60,
    build(el){ el.innerHTML = '<div class="cv"><canvas aria-label="G-G plot"></canvas></div>'; },
    render(c, inst){
      drawGG(inst.body.querySelector('canvas'), {T:REC.frozen || REC.trace, trail:5 * Pit.prefs.hz});
      inst.setInfo(`max lat ${REC.gHist.maxLat.toFixed(2)} · long ${REC.gHist.maxLon.toFixed(2)} g`);
    }});

  // ---------- live channels ----------
  const pauseNow = () => { setPaused(!REC.frozen); Pit.emit('pause', !!REC.frozen); Pit.dirty('rec'); };
  Pit.module({type:'channels', title:'Live channels', group:'Car', blurb:'Rolling traces of speed, pedals, steering, gear and more; hover to read values.',
    size:{w:6, h:8, minW:4, minH:5}, needs:['reading', 'rec'], rate:60,
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
