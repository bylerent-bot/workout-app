// node game/scoring.test.mjs — asserts, exits nonzero on failure
import { dayScore, rollup, normTrailing, normBodyweight, ageFactor, workUnits, T } from './scoring.js';

let n = 0;
const eq = (a, b, msg) => { n++; if (JSON.stringify(a) !== JSON.stringify(b)) { console.error(`FAIL ${msg}: got ${JSON.stringify(a)} want ${JSON.stringify(b)}`); process.exit(1); } };
const ok = (c, msg) => { n++; if (!c) { console.error(`FAIL ${msg}`); process.exit(1); } };

// rest day = zero
const rest = dayScore({});
eq(rest.total, 0, 'rest day scores 0');

// adherence only (no profile/history → no output normalizers)
const adh = dayScore({ session: { completed: true }, food: { planMet: true } });
eq(adh.parts.adherence, 400, 'full adherence = 400');
eq(adh.parts.output, 0, 'no normalizer inputs → output 0');
eq([adh.parts.session, adh.parts.food], [250, 150], 'adherence splits into session + food parts');

// rest-day food-only: fuel still pays
const foodOnly = dayScore({ food: { planMet: true } });
eq(foodOnly.total, T.adherence.food, 'food-only rest day = food points');
eq(foodOnly.parts.session, 0, 'no session points on a rest day');

// ad-hoc class counts as a session at the minute floor
ok(dayScore({ session: { adhocMinutes: T.adhocMinMinutes } }).sessionDone, 'adhoc >= floor counts');
ok(!dayScore({ session: { adhocMinutes: 5 } }).sessionDone, 'short adhoc does not count');

// bodyweight normalizer: a "big" lifting day (age 35, 200lb, 16000lb volume = 80x bw)
const bigLift = normBodyweight({ volumeLb: 16000 }, { bodyweightLb: 200, age: 35 });
eq(bigLift, 0.75, 'big lift day, no cardio = 1.0*0.75 + 0*0.25');

// hybrid day beats the weak-side penalty
const hybrid = normBodyweight({ volumeLb: 16000, hardMinutes: 60 }, { bodyweightLb: 200, age: 35 });
eq(hybrid, 1, 'big lift + big cardio = 1.0');

// age adjusts the demand down, never the score up
ok(ageFactor(45) < 1 && ageFactor(45) === 0.9, 'age 45 factor 0.9');
ok(ageFactor(30) === 1, 'under pivot = 1');
const older = normBodyweight({ volumeLb: 14400 }, { bodyweightLb: 200, age: 45 }); // 72x bw = "big" at 0.9 adj
eq(older, 0.75, 'age-adjusted big day');

// trailing: needs >=4 history days
eq(normTrailing({ volumeLb: 1000 }, [{ workUnits: 10 }]), null, 'thin history → null');
const hist = Array.from({ length: 10 }, () => ({ workUnits: 100 }));
const tNorm = normTrailing({ volumeLb: 10000 }, hist); // today WU=100 = 1.0x mean → atMean
eq(tNorm, T.trailing.atMean, 'normal day vs own baseline earns atMean');
eq(normTrailing({ volumeLb: 15000 }, hist), 1, 'cap: 1.5x baseline = 1.0');
eq(normTrailing({ volumeLb: 5000 }, hist), T.trailing.atMean / 2, 'half your mean = half of atMean');

// whoop is bonus-only and capped
const w = dayScore({ session: { completed: true }, extras: { whoopStrain: 25 } });
eq(w.parts.whoop, T.whoop.max, 'strain caps at max bonus');
const noW = dayScore({ session: { completed: true }, extras: {} });
eq(noW.parts.whoop, 0, 'no whoop = no penalty, just 0 bonus');

// coach bonus clamps
eq(dayScore({ extras: { coachBonus: 999 } }).parts.coach, T.coach.max, 'coach clamps to max');

// full house
const full = dayScore({
  session: { completed: true }, food: { planMet: true },
  today: { volumeLb: 16000, hardMinutes: 0 },
  profile: { bodyweightLb: 200, age: 43 },
  history: hist.map(h => ({ workUnits: 100 })),
  extras: { coachBonus: 100, whoopStrain: 15 },
});
ok(full.total > 700 && full.total <= 1050, `full day in range (${full.total})`);

// rollup
const r = rollup([{ total: 500 }, { total: 700 }, null]);
eq(r, { total: 1200, days: 2, avg: 600 }, 'rollup sums + averages');

// workUnits blends volume and minutes
eq(workUnits({ volumeLb: 1000, hardMinutes: 30 }), 70, 'work units');

console.log(`OK — ${n} assertions passed`);
