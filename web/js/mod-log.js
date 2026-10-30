'use strict';
// mod-log.js (D2): event-log, notes, advice. The log is the bridge's (edge-triggered, shared by every viewer) merged with
// this page's own lines (Pit.log); every text is escaped on the way into the table.
(() => {
  const CATS = ['LAP', 'PIT', 'FLAG', 'CAR', 'ENG', 'PLAN', 'CFG', 'RC', 'FIELD'];
  Pit.module({type:'event-log', title:'Events', group:'Log', blurb:'Everything logged: laps, pits, flags, race control, the field, plans sent.',
    size:{w:8, h:22, minW:4, minH:6}, needs:['log'],
    build(el, inst){
      inst.state.off = new Set(['FIELD']); inst.state.q = '';
      el.innerHTML = `<div class="ev-bar"><span class="ev-chips" role="group" aria-label="Categories">${CATS.map(k => `<button type="button" class="chip ev-chip" data-cat="${k}" aria-pressed="${k !== 'FIELD'}">${k}</button>`).join('')}</span>
        <input type="search" placeholder="Filter text" aria-label="Filter the events by text"><button type="button" class="btn" data-exp>Export session</button></div><table class="tt ev"><tbody></tbody></table>`;
      const again = () => inst.def.render(Pit.ctx, inst);
      el.addEventListener('click', e => {
        const b = e.target.closest('[data-cat]');
        if (b) { const k = b.dataset.cat, s = inst.state.off; s.has(k) ? s.delete(k) : s.add(k); b.setAttribute('aria-pressed', !s.has(k)); again(); }
        if (e.target.closest('[data-exp]')) exportSession();
      });
      el.querySelector('input').addEventListener('input', e => { inst.state.q = e.target.value.trim().toLowerCase(); again(); });
    },
    render(c, inst){
      const st = inst.state, all = c.log || [];
      const L = all.filter(e => !st.off.has(e.cat) && (!st.q || String(e.text).toLowerCase().includes(st.q)));
      const tb = inst.body.querySelector('tbody');
      const h = L.length ? L.slice(0, 300).map(e => `<tr><td class="n">${hms(new Date(e.t * 1000))}</td><td class="n">L${nf(e.lap, 0)}</td><td><b class="tag">${esc(e.cat)}</b></td><td class="ev-t">${sevLine(e.sev, e.text)}</td></tr>`).join('')
        : `<tr><td class="note">${all.length ? 'Nothing matches the filter.' : 'Events appear here as they happen.'}</td></tr>`;
      if (tb._h !== h) { setHtml(tb, h); refreshIcons(tb); }
      inst.setInfo(`${L.length}${L.length !== all.length ? ' of ' + all.length : ''} events`);
    }});

  Pit.module({type:'notes', title:'Notes', group:'Log', blurb:'Session notes, kept in this browser.', size:{w:4, h:14, minW:3, minH:5}, multi:false,
    build(el){
      el.innerHTML = '<div class="nt-bar"><button type="button" class="btn" data-ins title="Insert the time and lap at the cursor">Insert time</button><span class="note" role="status"></span></div><textarea class="notes" aria-label="Session notes" placeholder="Session notes"></textarea>';
      const t = el.querySelector('textarea'), msg = el.querySelector('.note'); t.value = lsRaw('pitwall.notes') || ''; let tm = 0;
      const save = () => { clearTimeout(tm); tm = setTimeout(() => { msg.textContent = lsSet('pitwall.notes', t.value) ? 'saved' : 'not saved: this browser blocks storage'; }, 300); };
      t.addEventListener('input', save);
      el.querySelector('[data-ins]').addEventListener('click', () => {
        const d = new Date(), c = Pit.ctx, lap = c && c.r ? c.r.session.lap_number : null;
        t.focus(); t.setRangeText(`[${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}${lap ? ' L' + lap : ''}] `, t.selectionStart, t.selectionEnd, 'end'); save();
      });
    },
    render(){}});

  Pit.module({type:'advice', title:'Engineer advice', group:'Log', blurb:"The engineer's advice, worst first.", size:{w:4, h:10, minW:3, minH:5},
    needs:['summary'], build(){}, render(c, inst){ const h = adviceHtml(c.s && c.s.advice); if (inst.body._h !== h) { setHtml(inst.body, h); refreshIcons(inst.body); } }});
})();
