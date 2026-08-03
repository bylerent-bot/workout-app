// Train (game) — benchmark shit-talk engine v1
// Compares a logged performance against REAL elite/military benchmarks and emits
// aggressive scoreboard copy. HARD RULE (discovery notes Q15): every number here is
// sourced + dated, or it carries verified:false and NEVER renders. No fabricated stats.
//
// Data shape: per movement, a ladder of {id, label, value, unit, dir, cls, source, checked, verified}
//   dir: 'higher' (more is better: lbs, reps) | 'lower' (less is better: seconds)
//   cls: 'wr' (world record) | 'elite' (pro/olympic) | 'mil' (military standard)

export const BENCH = {
  deadlift_1rm_lb: [
    { id: 'dl-wr', label: 'all-time deadlift world record (Hafthor Bjornsson, 510 kg, 2025)', value: 1124, unit: 'lb', dir: 'higher', cls: 'wr', source: 'generationiron.com / weights-app.com', checked: '2026-08-03', verified: true },
    { id: 'dl-strongman-avg', label: 'typical top-strongman competition deadlift', value: 900, unit: 'lb', dir: 'higher', cls: 'elite', source: 'PENDING — verify against WSM event results before ship', checked: null, verified: false },
  ],
  pushups_2min: [
    { id: 'pu-navy-sat-40s', label: 'Navy PRT satisfactory, male 40-44', value: 42, unit: 'reps', dir: 'higher', cls: 'mil', source: 'operationmilitarykids.org Navy PRT 2026', checked: '2026-08-03', verified: true },
    { id: 'pu-seal-min', label: 'Navy SEAL PST minimum', value: 50, unit: 'reps', dir: 'higher', cls: 'mil', source: 'military.com SEAL PST (updated standard)', checked: '2026-08-03', verified: true },
  ],
  situps_2min: [
    { id: 'su-seal-min', label: 'Navy SEAL PST minimum', value: 50, unit: 'reps', dir: 'higher', cls: 'mil', source: 'military.com SEAL PST', checked: '2026-08-03', verified: true },
  ],
  pullups_max: [
    { id: 'pl-seal-min', label: 'Navy SEAL PST minimum', value: 10, unit: 'reps', dir: 'higher', cls: 'mil', source: 'military.com SEAL PST (updated standard)', checked: '2026-08-03', verified: true },
  ],
  run_1p5mi_sec: [
    { id: 'run-seal-min', label: 'Navy SEAL PST minimum (10:30)', value: 630, unit: 'sec', dir: 'lower', cls: 'mil', source: 'military.com SEAL PST (updated standard)', checked: '2026-08-03', verified: true },
  ],
  swim_500yd_sec: [
    { id: 'swim-seal-min', label: 'Navy SEAL PST minimum (12:30)', value: 750, unit: 'sec', dir: 'lower', cls: 'mil', source: 'military.com SEAL PST', checked: '2026-08-03', verified: true },
  ],
  // Expand before ship (all pending verification): squat/bench WRs, olympic 2k row QT,
  // marathon/5k olympic standards, Army ACFT, Ranger/PJ standards. verified:false until sourced.
};

const fmtTime = s => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const fmt = (v, unit) => unit === 'sec' ? fmtTime(v) : `${v} ${unit}`;

// fraction of the benchmark achieved (0..1+); for 'lower' it's benchmark/you
export function fraction(perf, b) {
  if (perf <= 0) return 0;
  return b.dir === 'higher' ? perf / b.value : b.value / perf;
}

function frac8(f) { // nearest clean fraction for "1/8th of the world record" talk
  const dens = [2, 3, 4, 5, 6, 8, 10, 12, 16, 20];
  let best = null;
  for (const d of dens) {
    const num = Math.max(1, Math.round(f * d));
    const err = Math.abs(f - num / d);
    if (!best || err < best.err) best = { num, den: d, err };
  }
  return best.num === best.den ? '1/1' : `${best.num}/${best.den}`;
}

// One line per benchmark. Aggressive register is the product spec (discovery Q15/Q13).
export function talk(movement, perf) {
  const ladder = (BENCH[movement] || []).filter(b => b.verified);
  const lines = [];
  for (const b of ladder) {
    const f = fraction(perf, b);
    const passed = f >= 1;
    if (b.cls === 'mil') {
      lines.push(passed
        ? `${fmt(perf, b.unit)} — that PASSES the ${b.label} (${fmt(b.value, b.unit)}). Uncle Sam would take your ass.`
        : `${fmt(perf, b.unit)} — the ${b.label} is ${fmt(b.value, b.unit)}. They're not calling you back. Yet.`);
    } else if (b.cls === 'wr') {
      const gap = b.dir === 'higher' ? b.value - perf : perf - b.value;
      lines.push(passed
        ? `HOLY SHIT — you just beat the ${b.label}. Someone's lying to this app.`
        : `That's ${frac8(f)} of the ${b.label}. Only ${fmt(Math.abs(gap), b.unit)} to go, champ.`);
    } else {
      lines.push(passed
        ? `You're hanging with the pros: ${fmt(perf, b.unit)} clears the ${b.label}.`
        : `${fmt(perf, b.unit)} — a damn respectable ${Math.round(f * 100)}% of the ${b.label}.`);
    }
  }
  return lines;
}

// the single best line for compact UI: nearest benchmark above you (the next target),
// else the biggest one you've beaten
export function bestLine(movement, perf) {
  const ladder = (BENCH[movement] || []).filter(b => b.verified);
  if (!ladder.length) return null;
  const scored = ladder.map(b => ({ b, f: fraction(perf, b) }));
  const above = scored.filter(x => x.f < 1).sort((a, c) => c.f - a.f);
  const target = above[0] || scored.sort((a, c) => a.f - c.f)[0];
  return talk(movement, perf)[ladder.indexOf(target.b)];
}
