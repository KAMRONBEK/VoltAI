/**
 * Route-planner regression harness.
 *
 * A planner is exactly the kind of code where a silent 10-20% regression in trip time is
 * invisible without assertions — the output still looks like a plausible itinerary. These
 * assertions pin the behaviours that are easy to break and expensive to get wrong.
 *
 * Run: npm run plan:check   (from apps/api)
 *
 * Deliberately a plain script, not a test framework: apps/api has no test runner and adding one
 * as a side effect of this feature would be scope creep.
 */

import fs from "node:fs";
import path from "node:path";
import { Corridor, decodePolyline } from "../src/services/planner/corridor";
import { planRoute, type PlanResult } from "../src/services/planner/planner";

const DB_PATH = process.env.SQLITE_PATH ?? path.join(process.cwd(), "data", "voltai.sqlite");
// Resolved from cwd, not __dirname: `tsc` emits this script to dist/ but does not copy the JSON
// fixture beside it, so a __dirname-relative path would break for anyone running the built copy.
const FIXTURE = path.join(process.cwd(), "scripts", "fixtures", "tashkent-qarshi.json");

let failures = 0;
let checks = 0;

function check(name: string, ok: boolean, detail: string): void {
  checks++;
  if (ok) {
    console.log(`  PASS  ${name} — ${detail}`);
  } else {
    failures++;
    console.error(`  FAIL  ${name} — ${detail}`);
  }
}

/**
 * NOTE ON POWER: `connector.power` is frequently the SITE cabinet rating replicated onto every
 * gun, so a multi-gun site can overstate what one car actually gets. Fixing that lives in the
 * scraper (per-gun power) and is tracked separately; until then charge times at multi-gun sites
 * are optimistic. This harness asserts structure (how many stops, roughly where), not
 * minute-exact durations at those sites.
 *
 * Candidates come from the same repository function `/api/plan` uses — building them separately
 * here would mean testing a different graph than production serves.
 */

function summarize(label: string, res: PlanResult): void {
  console.log(`\n--- ${label} ---`);
  console.log(
    `  feasible=${res.feasible} candidates ${res.diagnostics.candidatesBeforeThinning} -> ` +
      `${res.diagnostics.candidatesAfterThinning}, labels=${res.diagnostics.labelsGenerated}, ` +
      `Rp=${res.diagnostics.planningRangeKm.toFixed(1)} km, gatekeepers=${res.diagnostics.gatekeepers.length}` +
      (res.diagnostics.unverifiedGatekeepers.length
        ? ` (${res.diagnostics.unverifiedGatekeepers.length} UNVERIFIED)`
        : "")
  );
  if (res.relaxations.length) console.log(`  relaxations: ${res.relaxations.join("; ")}`);
  if (res.blockingGap) {
    console.log(
      `  blocking gap: ${res.blockingGap.gapKm.toFixed(1)} km ` +
        `(km ${res.blockingGap.fromKm.toFixed(0)} -> ${res.blockingGap.toKm.toFixed(0)})`
    );
  }
  for (const p of res.plans) {
    const h = Math.floor(p.totalMin / 60);
    const m = Math.round(p.totalMin % 60);
    console.log(
      `  [${p.label}] ${h}h ${String(m).padStart(2, "0")}m — ${p.stops.length} stop(s), ` +
        `drive ${p.driveMin.toFixed(0)}m charge ${p.chargeMin.toFixed(0)}m plug ${p.plugMin}m ` +
        `wait ${p.waitMin.toFixed(0)}m terminal ${p.terminalMin}m, ` +
        `arrive ${(p.arriveSoc * 100).toFixed(1)}%, min SoC ${(p.minSoc * 100).toFixed(1)}%`
    );
    for (const s of p.stops) {
      console.log(
        `      km ${s.progressKm.toFixed(0).padStart(3)} | ${s.station.gunKw}kW | ` +
          `+${s.lateralKm.toFixed(1)}km | ${(s.arriveSoc * 100).toFixed(1)}% -> ` +
          `${(s.departSoc * 100).toFixed(1)}% in ${s.chargeMin.toFixed(1)}m` +
          `${s.isGatekeeper ? " [GATEKEEPER]" : ""} | ${s.station.name.slice(0, 38)}`
      );
    }
  }
}

async function main(): Promise<void> {
  if (!fs.existsSync(DB_PATH)) {
    console.error(`plan-check: no database at ${DB_PATH}`);
    process.exit(1);
  }

  process.env.SQLITE_PATH = DB_PATH;
  const { connectDatabase, disconnectDatabase } = await import("../src/db/sqlite");
  const { loadCandidateStations } = await import("../src/repositories/plannerRepo");
  await connectDatabase();

  const fixture = JSON.parse(fs.readFileSync(FIXTURE, "utf8"));
  const corridor = new Corridor(decodePolyline(fixture.polyline));
  const gbtLoad = loadCandidateStations("GBT_DC");
  const gbt = gbtLoad.stations;
  const ccs2 = loadCandidateStations("CCS2").stations;

  console.log(
    `corridor: ${corridor.totalKm.toFixed(1)} km decoded from ${corridor.points.length} vertices ` +
      `(MyTaxi reported ${(fixture.distanceM / 1000).toFixed(1)} km)`
  );
  console.log(
    `routable stations nationwide: GB/T DC ${gbt.length}, CCS2 ${ccs2.length}; ` +
      `${gbtLoad.unverified.length} GB/T sites excluded for unknown power`
  );

  const base = {
    corridor,
    // Statuses come from whatever the last scrape saw. The "quiet" assertions below (waitMin === 0)
    // must not turn red because a corridor site happens to be busy right now, so run them on
    // unknown statuses (exactly what plan.ts does for live=0); the all-busy variant is explicit.
    stations: gbt.map((s) => ({ ...s, status: "unknown" as const })),
    rangeKm: 400,
    startSoc: 0.8,
    vehicleMaxKw: 100,
  };

  // 1. The flagship case.
  const fastest = planRoute(base);
  summarize("Tashkent -> Qarshi, R=400 Pv=100kW start 80%", fastest);
  check(
    "flagship feasible",
    fastest.feasible && fastest.plans.length > 0,
    fastest.feasible ? "found a route" : "NO ROUTE"
  );
  if (fastest.plans.length) {
    const p = fastest.plans[0];
    check(
      "stop count is 2",
      p.stops.length === 2,
      `got ${p.stops.length} stop(s)`
    );
    check(
      "total time 6h30m-7h10m",
      p.totalMin >= 390 && p.totalMin <= 430,
      `${(p.totalMin / 60).toFixed(2)} h`
    );
    // The taper is the whole point: nothing should sit in the slow zone unless feasibility forces it.
    const highCharges = p.stops.filter((s, i) => s.departSoc > 0.8 && i < p.stops.length - 1);
    check(
      "no stop charges above 80% except the last before the gap",
      highCharges.length === 0,
      `${highCharges.length} early stop(s) above 80%`
    );
    check(
      "arrives with reserve intact (>=15%)",
      p.arriveSoc >= 0.149,
      `arrive ${(p.arriveSoc * 100).toFixed(1)}%`
    );
  }

  // 1b. The itinerary must be a strict sum. Wait time used to be hidden inside driveMin; the API
  //     now reports every component so the client can show the arithmetic, and it only can if
  //     nothing leaks between buckets. Also run with EVERY station busy so waitMin is non-zero
  //     (a partial marking is dodged by the optimizer, which just picks the quiet neighbours).
  const allBusy = planRoute({ ...base, stations: gbt.map((s) => ({ ...s, status: "busy" as const })) });
  for (const [tag, p] of [
    ...fastest.plans.map((p) => ["quiet", p] as const),
    ...allBusy.plans.map((p) => ["all-busy", p] as const),
  ]) {
    const sum = p.driveMin + p.chargeMin + p.plugMin + p.waitMin + p.terminalMin;
    const waitOk = tag === "all-busy" ? p.waitMin > 0 : p.waitMin === 0;
    check(
      `[${tag}/${p.label}] totalMin == drive + charge + plug + wait + terminal`,
      Math.abs(sum - p.totalMin) < 1e-6 && waitOk && p.driveMin > 0,
      `${p.totalMin.toFixed(2)} vs ${sum.toFixed(2)} (wait ${p.waitMin.toFixed(1)}m)`
    );
  }

  // 2. k-best must surface genuine alternatives, not collapse to a single plan.
  check(
    "k-best returns more than one option",
    fastest.plans.length >= 2,
    `${fastest.plans.length} plan(s): ${fastest.plans.map((p) => p.label).join(", ")}`
  );

  // 3. The taper must actually drive behaviour: charging into the slow zone is only ever
  //    justified when feasibility forces it. Any stop that departs deep WITHOUT a long gap ahead
  //    means either the curve is mis-tuned or the drive-time model has acquired a per-stop
  //    penalty that biases toward fewer, deeper charges.
  //
  //    This is asserted structurally rather than as "2 stops beat 1", because whether a one-stop
  //    plan even exists depends on the battery: at R=400 it is infeasible (224 km remaining plus
  //    49 km reserve plus the 16 km gap surcharge exceeds the 90% ceiling), and at R=550 one stop
  //    is genuinely optimal. Neither would prove anything about the taper.
  for (const p of fastest.plans) {
    const deepUnforced = p.stops.filter((s, i) => {
      const nextKm = i + 1 < p.stops.length ? p.stops[i + 1].progressKm : corridor.totalKm;
      const gapAhead = nextKm - s.progressKm;
      return s.departSoc > 0.65 && gapAhead <= 80;
    });
    check(
      `[${p.label}] no stop charges deep without a long gap ahead`,
      deepUnforced.length === 0,
      deepUnforced.length
        ? deepUnforced
            .map((s) => `${s.station.name.slice(0, 20)} -> ${(s.departSoc * 100).toFixed(0)}%`)
            .join(", ")
        : "all deep charges are gap-forced"
    );
  }

  // 3. A short-range car in winter must REFUSE, not invent a route.
  const winter = planRoute({ ...base, rangeKm: 250, tempDerate: 0.8 });
  summarize("R=250 winter (must refuse)", winter);
  check(
    "short-range winter refuses",
    !winter.feasible,
    winter.feasible ? "returned a route it should not have" : "refused"
  );
  check(
    "refusal names the blocking gap",
    !winter.feasible && !!winter.blockingGap,
    winter.blockingGap ? `${winter.blockingGap.gapKm.toFixed(0)} km` : "no gap reported"
  );

  // 4. CCS2 on the same corridor — the network is nearly disjoint from GB/T.
  const ccsPlan = planRoute({ ...base, stations: ccs2 });
  summarize("CCS2 car, same trip", ccsPlan);
  check(
    "CCS2 corridor is materially thinner than GB/T",
    ccsPlan.diagnostics.candidatesBeforeThinning < fastest.diagnostics.candidatesBeforeThinning / 2,
    `CCS2 ${ccsPlan.diagnostics.candidatesBeforeThinning} vs GB/T ${fastest.diagnostics.candidatesBeforeThinning} on-corridor`
  );

  // 5. Thinning must not change the answer, only the cost.
  check(
    "thinning is doing real work",
    fastest.diagnostics.candidatesAfterThinning < fastest.diagnostics.candidatesBeforeThinning / 3,
    `${fastest.diagnostics.candidatesBeforeThinning} -> ${fastest.diagnostics.candidatesAfterThinning}`
  );
  check(
    "Pareto cap never hit",
    !fastest.diagnostics.paretoCapHit,
    fastest.diagnostics.paretoCapHit ? "CAP HIT — results may be non-optimal" : "not hit"
  );

  // 6. Per-gun power. These pin the derivation that stops a "60+100kW" site reporting 160 kW on
  //    both guns — a 2.7x overestimate on the quantity the whole planner minimizes.
  const { derivePerGunPower, parseNamePowers } = await import("../src/services/perGunPower");

  const split = derivePerGunPower({ name: "Andalus 60+100kW", siteKw: 160, plugs: ["GBT", "GBT"] });
  check(
    "name-encoded per-gun power is believed",
    split.map((g) => g.kw).join(",") === "60,100" && split.every((g) => g.basis === "name"),
    `[${split.map((g) => g.kw).join(",")}] basis=${split[0]?.basis}`
  );

  const sharedGuns = derivePerGunPower({ name: "Tata 160kW", siteKw: 160, plugs: ["GBT", "GBT"] });
  check(
    "same-plug multi-gun is flagged as a shared cabinet at full rating",
    sharedGuns.every((g) => g.kw === 160 && g.sharedCabinet && g.basis === "site-shared"),
    `kw=${sharedGuns[0]?.kw} shared=${sharedGuns[0]?.sharedCabinet}`
  );

  const alternatives = derivePerGunPower({ name: "Mega Planet 60kW", siteKw: 60, plugs: ["GBT", "CCS2"] });
  check(
    "mixed-plug guns are alternatives, not a split cabinet",
    alternatives.every((g) => g.kw === 60 && !g.sharedCabinet),
    `kw=${alternatives[0]?.kw} shared=${alternatives[0]?.sharedCabinet}`
  );

  check(
    "a power figure is only read from a kW-suffixed token",
    parseNamePowers("Korzinka 2000").length === 0 && parseNamePowers("ЦУМ 30+60kW").join(",") === "30,60",
    `"Korzinka 2000" -> [${parseNamePowers("Korzinka 2000")}], "ЦУМ 30+60kW" -> [${parseNamePowers("ЦУМ 30+60kW")}]`
  );

  // No gun may claim more than the cabinet feeding it — the defect this whole fix addresses.
  const overclaim = gbt.filter((s) => s.gunKw !== null && s.gunKw > 240);
  check(
    "no station claims more power than the strongest cabinet in the country",
    overclaim.length === 0,
    overclaim.length ? overclaim.map((s) => `${s.name}=${s.gunKw}kW`).join(", ") : "max 240 kW respected"
  );

  // 7. The charge curve's invariant assert must actually fire on a rising curve.
  let threw = false;
  try {
    // k < 1 puts the knee below 0, so every band multiplier is computed above the knee; a
    // hand-built rising sequence is the only way to violate it, so we simulate via a bad preset.
    const { makeChargeCurve } = require("../src/services/planner/chargeCurve");
    makeChargeCurve({ rpKm: 300, effectiveKw: 100, consKwhKm: 0.18, derate: 0.82, k: Number.NaN });
  } catch {
    threw = true;
  }
  check("degenerate curve params are rejected", threw, threw ? "threw" : "silently accepted NaN");

  await disconnectDatabase();

  console.log(`\n${checks - failures}/${checks} checks passed`);
  if (failures) process.exit(1);
}

void main();
