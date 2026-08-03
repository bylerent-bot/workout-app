// Train (game) — scoring engine v1
// Pure functions, no I/O. Used by the app client-side and by the coach loop.
// Day score 0–1000 + bonuses. Design decisions: discovery notes 2026-08-03.
//   ADHERENCE (0–400): did you do YOUR day — session done (or logged ad-hoc work) + food plan hit
//   OUTPUT    (0–450): normalized output, the heavy weight — mean of available normalizers:
//                      trailing baseline, bodyweight-relative, age-adjusted gen-pop bands
//   COACH     (0–150): async judgment bonus from the review loop (defaults 0)
//   WHOOP     (0–50 bonus, OUTSIDE the core): strain only ever adds; players without one lose nothing
// All tuning constants live in T so the formula can be rebalanced without touching logic.

export const T = {
  adherence: { session: 250, food: 150 },
  output: { max: 450 },
  coach: { max: 150 },
  whoop: { max: 50, strainCap: 20 },
  // ad-hoc/class minimum to count as a completed session
  adhocMinMinutes: 20,
  // trailing: today vs rolling mean; 1.0 = your normal day, capped so one monster day can't run away
  trailing: { windowDays: 28, cap: 1.5 },
  // bodyweight-relative lifting bands: session volume (lb) / bodyweight (lb).
  // 0 → 0, "solid" → ~0.7 of the band, "big" → 1.0. Rough gen-pop-informed anchors, tunable.
  volPerBw: { solid: 40, big: 80 },
  // cardio/work minutes: hard minutes toward a full output day
  hardMinutes: { solid: 30, big: 60 },
  // age adjustment: +1%/yr over 35 on the demand side (a 45yo's "big" is 90% of a 35yo's)
  age: { pivot: 35, perYear: 0.01, maxAdjust: 0.35 },
};

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

// piecewise ramp: 0→0, solid→0.7, big→1.0, linear between
function band(x, solid, big) {
  if (x <= 0) return 0;
  if (x <= solid) return 0.7 * (x / solid);
  return clamp(0.7 + 0.3 * ((x - solid) / (big - solid)), 0, 1);
}

export function ageFactor(age) {
  if (!age || age <= T.age.pivot) return 1;
  return 1 - clamp((age - T.age.pivot) * T.age.perYear, 0, T.age.maxAdjust);
}

// ---- output normalizers (each returns 0..1 or null when its inputs are missing) ----

// today's raw work summary, from the session log:
// { volumeLb, hardMinutes, done, adhoc:{minutes, kind} }
export function normTrailing(today, history) {
  const w = (history || []).slice(-T.trailing.windowDays).filter(d => d && d.workUnits > 0);
  if (w.length < 4) return null; // not enough history to self-reference
  const mean = w.reduce((s, d) => s + d.workUnits, 0) / w.length;
  if (mean <= 0) return null;
  return clamp(workUnits(today) / mean, 0, T.trailing.cap) / T.trailing.cap;
}

export function normBodyweight(today, profile) {
  if (!profile || !profile.bodyweightLb) return null;
  const af = ageFactor(profile.age);
  const lift = band((today.volumeLb || 0) / profile.bodyweightLb, T.volPerBw.solid * af, T.volPerBw.big * af);
  const cardio = band(today.hardMinutes || 0, T.hardMinutes.solid, T.hardMinutes.big);
  // a day earns via either modality; blend favors the stronger one so hybrid days aren't punished
  return clamp(Math.max(lift, cardio) * 0.75 + Math.min(lift, cardio) * 0.25, 0, 1);
}

// one comparable "work units" scalar for the trailing baseline (volume + hard minutes)
export function workUnits(day) {
  return (day.volumeLb || 0) / 100 + (day.hardMinutes || 0) * 2;
}

// ---- the day score ----

// inputs:
//  session: { completed:bool, adhocMinutes:number }   food: { planMet:bool }
//  today:   { volumeLb, hardMinutes }
//  profile: { bodyweightLb, age }
//  history: [{ workUnits }] chronological, excludes today
//  extras:  { coachBonus:0..150, whoopStrain:number|null }
export function dayScore(inp) {
  const { session = {}, food = {}, today = {}, profile = {}, history = [], extras = {} } = inp;

  const sessionDone = !!session.completed || (session.adhocMinutes || 0) >= T.adhocMinMinutes;
  const adherence = (sessionDone ? T.adherence.session : 0) + (food.planMet ? T.adherence.food : 0);

  const norms = [normTrailing(today, history), normBodyweight(today, profile)].filter(n => n !== null);
  const outputN = norms.length ? norms.reduce((s, n) => s + n, 0) / norms.length : 0;
  const output = Math.round(outputN * T.output.max * (sessionDone || (today.volumeLb || today.hardMinutes) ? 1 : 0));

  const coach = clamp(Math.round(extras.coachBonus || 0), 0, T.coach.max);
  const whoop = extras.whoopStrain != null
    ? Math.round(clamp(extras.whoopStrain / T.whoop.strainCap, 0, 1) * T.whoop.max)
    : 0;

  return {
    total: adherence + output + coach + whoop,
    parts: { adherence, output, coach, whoop },
    workUnits: workUnits(today),
    sessionDone,
  };
}

// ---- rollups ----
export function rollup(dayScores) {
  const days = dayScores.filter(Boolean);
  return {
    total: days.reduce((s, d) => s + d.total, 0),
    days: days.length,
    avg: days.length ? Math.round(days.reduce((s, d) => s + d.total, 0) / days.length) : 0,
  };
}
