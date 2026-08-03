// node game/benchmarks.test.mjs
import { BENCH, fraction, talk, bestLine } from './benchmarks.js';

let n = 0;
const ok = (c, msg) => { n++; if (!c) { console.error(`FAIL ${msg}`); process.exit(1); } };

// unverified entries never render
const dl = talk('deadlift_1rm_lb', 400);
ok(dl.length === 1, 'pending strongman-avg entry excluded from output');
ok(dl[0].includes('world record'), 'WR line renders');

// fractions
const wr = BENCH.deadlift_1rm_lb[0];
ok(Math.abs(fraction(281, wr) - 0.25) < 0.001, 'fraction of WR');
ok(fraction(0, wr) === 0, 'zero perf = 0');

// lower-is-better (run): faster than the standard passes
const seal = BENCH.run_1p5mi_sec.find(b => b.id === 'run-seal-min');
ok(fraction(600, seal) > 1, '10:00 run beats the 10:30 SEAL minimum');
ok(fraction(700, seal) < 1, '11:40 run misses it');

// military pass/fail copy
ok(talk('pushups_2min', 55).every(l => l.includes('PASSES')), '55 pushups passes both mil standards');
const pu40 = talk('pushups_2min', 45);
ok(pu40[0].includes('PASSES') && pu40[1].includes('not calling you back'), '45 passes Navy sat, misses SEAL min');

// bestLine picks the next target above you
ok(bestLine('pushups_2min', 45).includes('SEAL'), 'next target = SEAL min');
ok(bestLine('nonexistent', 10) === null, 'unknown movement = null');

// time formatting in copy
ok(talk('run_1p5mi_sec', 660)[0].includes('10:30'), 'benchmark time formatted mm:ss');

console.log(`OK — ${n} assertions passed`);
