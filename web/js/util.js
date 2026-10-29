'use strict';
// Shared helpers, user settings and unit conversion. Loaded first; everything else uses these globals.
const $ = id => document.getElementById(id);
const CORNERS = ['FL','FR','RL','RR'];

// ---------- settings (kept in this browser) ----------
const DEF = {speed:'kmh', temp:'c', press:'psi', sound:false,
  psiMin:26.0, psiMax:28.5, tMin:70, tMax:105, brakeMax:800, padMin:12, fuelLaps:3,   // the application's defaults, native units (psi, °C, mm)
  rows:['speed', 'pedals', 'steer', 'gearrpm'], notes:''};
const S = (() => { let o = {}; try { o = JSON.parse(localStorage.getItem('engineer.settings') || '{}'); } catch (e) {} return Object.assign({}, DEF, o); })();
const saveS = () => { try { localStorage.setItem('engineer.settings', JSON.stringify(S)); } catch (e) {} };
const ALERT = S;

// ---------- units: values arrive in km/h, °C, psi; convert only for display ----------
const UNITS = {
  speed:{kmh:{f:v => v, u:'km/h', d:0}, mph:{f:v => v * 0.621371, u:'mph', d:0}},
  temp:{c:{f:v => v, u:'°C', d:0}, f:{f:v => v * 1.8 + 32, u:'°F', d:0}},
  press:{psi:{f:v => v, u:'psi', d:1}, bar:{f:v => v * 0.0689476, u:'bar', d:2}, kpa:{f:v => v * 6.89476, u:'kPa', d:0}},
};
const un = kind => UNITS[kind][S[kind]];
const fv = (kind, v, d) => un(kind).f(v).toFixed(d == null ? un(kind).d : d);   // formatted value, no unit
const fvu = (kind, v, d) => `${fv(kind, v, d)}<span class="u">${un(kind).u}</span>`;

// ---------- formatting ----------
const fmtLap = ms => (!ms || ms <= 0 || ms > 3.6e6) ? '—' : `${Math.floor(ms/60000)}:${String(Math.floor(ms%60000/1000)).padStart(2,'0')}.${String(Math.round(ms%1000)).padStart(3,'0')}`;
const fmtDelta = ms => (ms == null || !isFinite(ms)) ? '—' : (Math.abs(ms) < 0.5 ? '0.000' : (ms > 0 ? '+' : '−') + (Math.abs(ms)/1000).toFixed(3));
const fmtClock = ms => { if (ms == null || ms < 0 || ms > 1e9) return '—'; const s = Math.floor(ms/1000); return `${Math.floor(s/3600)}:${String(Math.floor(s%3600/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`; };
const f1 = v => (v == null ? '—' : (+v).toFixed(1));
const hms = d => d.toLocaleTimeString([], {hour12:false});
const unit = (v, u) => `${v}<span class="u">${u}</span>`;
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;'}[c]));

// ---------- thresholds ----------
const cls = (v, lo, hi) => v < lo || v > hi ? (v < lo - 2 || v > hi + 10 ? 'bad' : 'warn') : '';
const tcls = v => v < ALERT.tMin ? 'cold' : v > ALERT.tMax + 10 ? 'bad' : v > ALERT.tMax ? 'warn' : '';
const coreT = (c, i, cap) => cap && cap.tyre_edge_temps ? (c.tyre_temp_inner_c[i] + c.tyre_temp_middle_c[i] + c.tyre_temp_outer_c[i]) / 3 : c.tyre_core_temp_c[i];

// ---------- icons ----------
const icon = n => { const el = document.createElement('i'); el.setAttribute('data-lucide', n); return el; };
const sevIcon = s => s >= 2 ? 'octagon-alert' : s === 1 ? 'triangle-alert' : 'info';
const refreshIcons = root => lucide.createIcons({nodes: [...(root || document).querySelectorAll('[data-lucide]')]});

// ---------- files ----------
function download(name, obj){
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(obj)], {type:'application/json'})); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- sound ----------
let actx = null;
function beep(){
  if (!S.sound) return;
  try { actx = actx || new AudioContext(); const o = actx.createOscillator(), g = actx.createGain(); o.frequency.value = 880; g.gain.value = .08; o.connect(g); g.connect(actx.destination); o.start(); o.stop(actx.currentTime + .18); } catch (e) {}
}
