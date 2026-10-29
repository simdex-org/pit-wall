'use strict';
// The Strategy tab as a board the engineer arranges: which modules show, their order and size, and the colour theme,
// all kept in this browser (S.board, S.theme, S.accent). Each module is a <section class="mod" data-mod> in index.html;
// this file only moves, sizes and hides them; views.js draws what is inside.

// Default size in grid cells (12 columns, 72 px rows) and the smallest that still reads.
const MODS = {
  timeline:{w:12, h:2, mw:6, mh:2}, fuel:{w:3, h:4, mw:2, mh:3}, window:{w:5, h:4, mw:4, mh:3}, gaps:{w:2, h:4, mw:2, mh:2},
  weather:{w:2, h:4, mw:2, mh:3}, tyres:{w:4, h:4, mw:3, mh:4}, degradation:{w:5, h:4, mw:3, mh:3}, brakes:{w:3, h:4, mw:3, mh:3},
  pitstop:{w:12, h:8, mw:6, mh:6}, electronics:{w:6, h:3, mw:3, mh:3}, damage:{w:6, h:3, mw:3, mh:3},
};
const ROW_PX = 72, GAP_PX = 10;
const board = $('board'), modEl = id => board.querySelector(`.mod[data-mod="${id}"]`);
const modTitle = id => modEl(id).querySelector('.ph').firstChild.textContent.trim();
const defaultLayout = () => Object.entries(MODS).map(([id, m]) => [id, m.w, m.h, true]);   // [id, width, height, shown], in order
let layout = (() => {
  const saved = Array.isArray(S.board) ? S.board.filter(r => Array.isArray(r) && MODS[r[0]]) : [];
  return [...saved, ...defaultLayout().filter(d => !saved.some(r => r[0] === d[0]))];   // modules added in a later version join at the end
})();
const at = id => layout.findIndex(r => r[0] === id);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
let editing = false, dragId = null;

function applyBoard(){
  layout.forEach(([id, w, h, shown], i) => {
    const el = modEl(id); el.style.order = i; el.hidden = !shown;
    el.style.setProperty('--w', w); el.style.setProperty('--wm', Math.min(w, 6)); el.style.setProperty('--h', h);
  });
  const off = layout.filter(r => !r[3]);
  $('boardAdd').innerHTML = `<option value="">${off.length ? 'Choose…' : 'All shown'}</option>` + off.map(r => `<option value="${r[0]}">${esc(modTitle(r[0]))}</option>`).join('');
  $('boardAdd').disabled = !off.length;
}
function saveBoard(){ S.board = layout; saveS(); applyBoard(); render(); }

function moveBy(id, d){   // to the next shown module that way
  const i = at(id); let j = i + d;
  while (layout[j] && !layout[j][3]) j += d;
  if (!layout[j]) return;
  layout.splice(j, 0, layout.splice(i, 1)[0]);
}

// ---------- edit mode: tools on each title bar, a resize grip in each corner ----------
const TOOLS = [['prev', 'arrow-left', 'Move earlier'], ['next', 'arrow-right', 'Move later'], ['narrow', 'chevrons-right-left', 'Narrower'],
  ['wide', 'chevrons-left-right', 'Wider'], ['short', 'chevrons-down-up', 'Shorter'], ['tall', 'chevrons-up-down', 'Taller'], ['hide', 'x', 'Remove']];
board.querySelectorAll('.mod').forEach(m => {
  const t = document.createElement('span'); t.className = 'mod-tools';
  t.innerHTML = TOOLS.map(([a, ic, l]) => `<button type="button" data-a="${a}" aria-label="${l}: ${esc(modTitle(m.dataset.mod))}" title="${l}"><i data-lucide="${ic}"></i></button>`).join('');
  m.querySelector('.ph').appendChild(t);
  m.insertAdjacentHTML('beforeend', '<span class="mod-grip" title="Drag to resize" aria-hidden="true"></span>');
});
board.addEventListener('click', e => {
  const b = e.target.closest('.mod-tools button'); if (!b) return;
  const id = b.closest('.mod').dataset.mod, r = layout[at(id)], d = MODS[id];
  ({prev:() => moveBy(id, -1), next:() => moveBy(id, 1), narrow:() => { r[1] = clamp(r[1] - 1, d.mw, 12); }, wide:() => { r[1] = clamp(r[1] + 1, d.mw, 12); },
    short:() => { r[2] = clamp(r[2] - 1, d.mh, 14); }, tall:() => { r[2] = clamp(r[2] + 1, d.mh, 14); }, hide:() => { r[3] = false; }})[b.dataset.a]();
  saveBoard();
});
function setEditing(on){
  editing = on; board.classList.toggle('editing', on); $('boardBar').hidden = !on;
  $('boardEdit').setAttribute('aria-pressed', on); $('boardEdit').lastChild.textContent = on ? 'Done' : 'Customize';
  board.querySelectorAll('.mod > .ph').forEach(h => { h.draggable = on; });
}
$('boardEdit').addEventListener('click', () => setEditing(!editing));
$('boardAdd').addEventListener('change', e => { const i = at(e.target.value); if (i >= 0) { layout[i][3] = true; saveBoard(); } });
$('boardReset').addEventListener('click', () => { layout = defaultLayout(); saveBoard(); });

// Move: drag a title bar onto another module; it lands before or after it, whichever half the pointer is over.
const after = (e, m) => { const b = m.getBoundingClientRect(); return e.clientX > b.left + b.width / 2; };
const unmark = () => board.querySelectorAll('.drop-before,.drop-after,.dragging').forEach(m => m.classList.remove('drop-before', 'drop-after', 'dragging'));
board.addEventListener('dragstart', e => {
  const m = e.target.closest('.mod'); if (!editing || !m) return;
  dragId = m.dataset.mod; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragId); m.classList.add('dragging');
});
board.addEventListener('dragover', e => {
  const m = e.target.closest('.mod'); if (!dragId || !m || m.dataset.mod === dragId) return;
  e.preventDefault(); unmark(); modEl(dragId).classList.add('dragging'); m.classList.add(after(e, m) ? 'drop-after' : 'drop-before');
});
board.addEventListener('drop', e => {
  const m = e.target.closest('.mod'); if (!dragId || !m || m.dataset.mod === dragId) return;
  e.preventDefault();
  const r = layout.splice(at(dragId), 1)[0];
  layout.splice(at(m.dataset.mod) + (after(e, m) ? 1 : 0), 0, r);
  saveBoard();
});
board.addEventListener('dragend', () => { dragId = null; unmark(); });

// Resize: drag the corner grip; the size snaps to whole cells.
board.addEventListener('pointerdown', e => {
  const g = e.target.closest('.mod-grip'); if (!g || !editing) return;
  e.preventDefault(); g.setPointerCapture(e.pointerId);
  const id = g.closest('.mod').dataset.mod, r = layout[at(id)], d = MODS[id], w0 = r[1], h0 = r[2], x0 = e.clientX, y0 = e.clientY;
  const cell = (board.clientWidth + GAP_PX) / 12;
  const move = ev => { r[1] = clamp(Math.round(w0 + (ev.clientX - x0) / cell), d.mw, 12); r[2] = clamp(Math.round(h0 + (ev.clientY - y0) / (ROW_PX + GAP_PX)), d.mh, 14); applyBoard(); };
  g.addEventListener('pointermove', move);
  g.addEventListener('pointerup', () => { g.removeEventListener('pointermove', move); saveBoard(); }, {once:true});
});

// ---------- colour theme: a preset, and an accent of the engineer's own ----------
function applyTheme(){
  const root = document.documentElement, st = root.style, a = S.accent;
  root.dataset.theme = S.theme || 'timing';
  ['--acc', '--acc-soft', '--acc-ink'].forEach(v => st.removeProperty(v));
  if (/^#[0-9a-f]{6}$/i.test(a || '')) {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(a.slice(i, i + 2), 16));
    st.setProperty('--acc', a); st.setProperty('--acc-soft', a + '24');
    st.setProperty('--acc-ink', 0.2126 * r + 0.7152 * g + 0.0722 * b > 140 ? '#08090b' : '#ffffff');   // readable text on the accent
  }
  $('themePreset').value = S.theme || 'timing'; $('themeAccent').value = css('--acc');
}
$('themePreset').addEventListener('change', e => { S.theme = e.target.value; S.accent = null; saveS(); applyTheme(); render(); });
$('themeAccent').addEventListener('input', e => { S.accent = e.target.value; saveS(); applyTheme(); render(); });

applyTheme();
applyBoard();
