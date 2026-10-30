// node tools/fuelplan_check.js : checks fuelPlan() from web/js/mod-plan.js
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const src = fs.readFileSync(__dirname + '/../web/js/mod-plan.js', 'utf8');
const fuelPlan = vm.runInNewContext(src.slice(src.indexOf('function fuelPlan'), src.indexOf('(() =>')) + ';fuelPlan');
const base = {raceMin:180, raceLaps:null, extra:0, lapS:108, fpl:3, cap:120, reserve:1, formL:3, mand:0, maxStintMin:null, lossS:25, refuelSpl:.25, tyreS:30, tyres:true, seq:false, minStat:0, wt:0};
let p = fuelPlan(base);
assert.equal(p.total, 100);                                  // 10800 s / 108 s
assert.equal(p.best.n, 2);                                   // 100 laps * 3 L = 300 L: a stint is at most 38 laps (115 L + 3 reserve + ... fits 120)
assert.ok(p.best.stints.every(s => s.load <= 120));
assert.equal(p.best.stints.reduce((a, s) => a + s.laps, 0), 100);
p = fuelPlan({...base, mand:3});                             // the rules force 3 stops even though 2 are enough for the tank
assert.equal(p.best.n, 3);
p = fuelPlan({...base, raceMin:null, raceLaps:30});
assert.equal(p.best.n, 0); assert.equal(p.best.start, 30 * 3 + 3 + 3);
assert.ok(p.save === null);                                   // already no stops
p = fuelPlan({...base, raceMin:null, raceLaps:40});          // 40 laps = 120+3+3 > 120: one stop; 20+20 laps would fit
assert.equal(p.best.n, 1); assert.ok(p.save.fpl < 3);
assert.equal(fuelPlan({...base, fpl:0}).total, null);
console.log('fuelPlan ok');
