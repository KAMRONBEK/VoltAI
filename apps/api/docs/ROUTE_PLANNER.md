# EV Route Planner — design and implementation status

Derived from a multi-agent research + adversarial-review pass (2026-08-13). Sections 1-6 are the
technical core; the phasing/blockers/open-questions material follows.

## Implementation status

| part | status | where |
|---|---|---|
| Connector canonicalization | IMPLEMENTED | `src/services/connectorNormalizer.ts` |
| Charge curve (log-mean PWL) | IMPLEMENTED, reproduces the band table below to 4 dp | `src/services/planner/chargeCurve.ts` |
| Corridor projection + gaps | IMPLEMENTED | `src/services/planner/corridor.ts` |
| Label-setting search | IMPLEMENTED | `src/services/planner/planner.ts` |
| Regression harness (22 checks) | IMPLEMENTED, runs in `npm run lint` | `scripts/plan-check.ts` |
| Per-gun power (cabinet smear) | IMPLEMENTED — tokbor + beon; k-watt already had real per-gun data | `src/services/perGunPower.ts` |
| MyTaxi routing client + cache | IMPLEMENTED — 90-day cache, geometry validation on fetch AND on read, token bucket, breaker (5xx/network/timeout only), 10-min per-key negative cache for 4xx/malformed, single-flight, `pruneRouteCache()` each scrape cycle | `src/services/routing/mytaxi.ts` |
| `GET /api/plan` endpoint | IMPLEMENTED, plus `/api/plan/health` — per-IP token bucket (429), knob validation (400), service-area bbox (400), inflight shed (503), geometry-aware ETag, short cache policy on degraded answers | `src/routes/plan.ts` |
| `mergeStations()` O(n²) fix | IMPLEMENTED — 8966 ms → 180 ms, output byte-identical | `src/services/mergeService.ts` |
| Merge equivalence guard | IMPLEMENTED, runs in `npm run lint` | `scripts/merge-check.ts` |
| Garage (model, storage, 2 screens, plug gate, PHEV/CLTC guards) | IMPLEMENTED | `apps/mobile/lib/vehicles/garage.ts`, `app/garage/*` |
| Trip input + drop-a-pin picker | IMPLEMENTED | `app/(tabs)/route.tsx`, `app/plan/pick.tsx` |
| Polyline decoder + plan client | IMPLEMENTED | `apps/mobile/lib/routing/polyline.ts`, `lib/plan/planClient.ts` |
| Results screen — own map, `Polyline`, stop pins, honesty chips, nav handoff | IMPLEMENTED | `app/plan/results.tsx` |
| Saved trips (materialized) + offline fallback | IMPLEMENTED | `lib/plan/planHistory.ts`, `app/plan/history.tsx` |
| `GET /api/plan/pack` (offline solve) | NOT DONE — v2 | — |

**Three mobile decisions below were overtaken by the implementation.** Recorded here rather than
rewritten in place, so the reasoning stays readable next to what actually shipped:

1. **Trip input is a tab, not a FAB + root Stack route** (§6.2). The floating pill grew a third
   item; `floating-tab-bar.tsx`'s `ICONS` and `icon-symbol.tsx`'s `MAPPING` union were widened to
   match. Everything the tab pushes to — garage, picker, results, saved trips — is still a root
   Stack route, so those screens keep a real back stack and no tab-bar inset.
2. **jotai is installed and is the state layer** (§4.1, §10). Two React Contexts were the plan;
   the garage and the saved-trip index are jotai atoms instead, hydrated once from AsyncStorage in
   `app/_layout.tsx`. AsyncStorage is still the only persistence dependency — no MMKV, no
   expo-sqlite — and the pure planner modules remain React-free.
3. **`@gorhom/bottom-sheet` is not used on the results screen** (§6.2). It is a plain absolutely
   positioned sheet whose height is measured with `onLayout` and fed back into the map's
   `fitMarkers` padding, which is what the framing actually needs.

Measured on the real corridor (Tashkent → Qarshi, recorded MyTaxi polyline, real station DB):
route 453.9 km · 351 on-corridor candidates thinned to 24 · `planRoute` 54 ms in V8 ·
worst charger-free stretch **135.0 km (km 317 → 452), ending at the destination**.

ARCHITECTURE NOTE: the planner modules above are deliberately **pure** — no Node, Express or SQLite
imports — so they can be exercised from a plain script (`scripts/plan-check.ts`) and stay portable.
Keep them that way.

> **Correction (2026-08-15).** This note previously claimed the API and scrapers were "moving into
> the mobile app", with one dedicated phone serving other installs and `expo-sqlite` replacing
> `node-sqlite3-wasm`. **That is not the architecture and never shipped.** The API and the scrapers
> stay a **Node/Express process running under Termux on the dedicated always-on Android phone**, with
> **`node-sqlite3-wasm`** as the store and a Cloudflare Tunnel dialing out to serve
> `https://api.voltai.uz`. Nothing moves into the Expo app; there is no `expo-sqlite`. Section 5 (API
> design) and section 6 (mobile design) below describe a separate Node backend, which is correct and
> current. Why: [`../../../ARCHITECTURE.md`](../../../ARCHITECTURE.md) · How it is deployed:
> [`../RUNBOOK.md`](../RUNBOOK.md).

---

# VoltAI Route Planner — Technical Core

## 1. Recommendation

Build a **corridor-linearized label-setting search over a thinned station DAG with continuous SoC**: one routing call gives a base polyline, stations project onto it as (progress, lateral), and a Dijkstra with 2-D Pareto dominance on (time, SoC) finds the time-optimal charging plan exactly, in ~14 ms at C≈24 candidates. The key insight is that DC power is non-increasing in SoC, so time-to-charge τ is convex; discretize the CC-CV taper into a staircase whose band powers are **log-means** (making τ piecewise-linear and exact at every band edge), and the optimal departure SoC at each stop provably lands on a *finite* enumerable set — each station's own breakpoints plus the next station's breakpoints shifted by the leg energy — so no SoC grid, no convex solver, no error term inside the search. Everything that can still be wrong lives in the data (connector standard, per-gun power, stale status) and in the user's stated range, so the safety machinery — a cut-vertex "gatekeeper" pass, a gap surcharge, confidence-gated routing, and a reserve that is never traded away for feasibility — is where the engineering budget goes.

---

## 2. The algorithm

### 2.1 Units and state

| symbol | definition | default |
|---|---|---|
| `R` | user's real-world km at 100%, mild weather, mostly highway | required |
| `D_style` | 0.90 relaxed / **0.82 normal** / 0.72 fast | 0.82 |
| `D_temp` | mild 1.00, winter toggle 0.80 (v1.1: Open-Meteo bands) | 1.00 |
| `Rp` | `R · D_style · D_temp` — **planning km**, the unit of state | — |
| `c` | consumption kWh/km | 0.18 |
| `B` | `R · c` — derived pack kWh. **Never asked of the user.** | — |
| `Pv` | vehicle DC cap kW | 90 (unknown GB/T) |
| `η` | DC efficiency, applied to power only, never re-applied above 80% | 0.90 |
| `k` | taper aggressiveness | lfp 2.0 / **standard 1.8** / peaky 1.3 |

State `s` ∈ [0, Rp] in planning-km; `σ = s/Rp`. Driving consumes 1 planning-km per road-km. **There is no second derate on distance** — applying both `Rp = R·0.82` and `DERATE = 1.08` on legs double-counts by 8%, which is the difference between a plan and a refusal on the 132 km gap.

`P_eff = min(Pv, gunKw)`. Full-power rate: `rate₁ = P_eff · η / (60·c) · D_style · D_temp` planning-km/min. At 100 kW, c=0.18, D=0.82: **6.833 km/min**.

### 2.2 Charging function — closed form and its exact PWL surrogate

Ground truth (CC-CV linear taper; measured curves fit `P ∝ (1−σ)`, the literal downward parabola is disqualified because it reaches zero power at σ=s₁ and makes high SoC unreachable):

```
P(σ) = P_eff · min(1, k(1−σ))        knee σ_k = 1 − 1/k   (0.4444 at k=1.8)
τ_exact(σa→σb) = (σb−σa)·Rp/rate₁                              both ≤ σ_k
               = Rp/(rate₁·k) · ln((1−σa)/(1−σb))              both ≥ σ_k
               = split at σ_k otherwise
```

Integrating gives `σ(t) = 1 − (1−σ₀)e^{−λt}` — the flattening curve the user calls "parabolic declining". Plot **that** in the UI, never power-vs-SoC.

The search needs τ piecewise-**linear**, so discretize P into a staircase with the **log-mean** band multiplier, which makes staircase time equal the CC-CV integral **exactly at every band edge**:

```
m_b = k(σb − σa) / ln((1−σa)/(1−σb))     above knee;  m_b = 1 below
```
Chord slopes of a convex increasing τ are non-decreasing ⇒ `m_b` is non-increasing **by construction**; the grid cannot break the invariant. Still `assertNonIncreasing()` at module load and throw, with a comment naming which proof breaks (see §2.7 D1).

Grid, geometric in (1−σ) so per-band time is equalized (11 bands, k=1.8):

| band | ≤.4444 | –.50 | –.55 | –.60 | –.65 | –.70 | –.75 | –.80 | –.85 | –.90 |
|---|---|---|---|---|---|---|---|---|---|---|
| `m_b` | 1.0000 | .9491 | .8542 | .7641 | .6740 | .5838 | .4936 | .4033 | .3128 | .2220 |

`τ_j(s)` = cumulative minutes from empty, O(11). `chargeMin = τ_j(d) − τ_j(a) + T_PLUG` (valid only via the shift property — never add preconditioning or arrival-temperature terms). `BP_j = {σ_b · Rp}`.

**Error, stated correctly:** with this grid the worst per-session over-estimate vs the exact integral is **≈ 0.43 min**. Do **not** claim this is one-sided/conservative for the quantity the solver uses: `τ(d) − τ(a)` with `a` mid-band (over-estimated) and `d` on a breakpoint (exact) **under**-estimates. The magnitude bound holds; the sign claim does not, and must never be used to justify shaving margin.

Hard clamp `σ_max = 0.90`. Above it the model is least trustworthy, τ diverges at 1.0, and no driver executes a plan that requires 98%.

### 2.3 Drive-time model — **additive over legs, independent of stop count**

```
driveMin(i,j) = 60·(progress_j − progress_i)/V_INTER
              + 60·(0.5·det_i + 0.5·det_j)/V_DETOUR
det_k = 2·lateral_k · (lateral_k < 2 ? 1.00 : 1.35)     det_origin = det_dest = 0
T_TERMINAL = 20 min, added ONCE PER TRIP (10 min each end), never per leg
V_INTER = 80 km/h,  V_DETOUR = 45 km/h        (env: PLAN_V_INTERCITY / PLAN_V_DETOUR)
```

Summing over any stop sequence: `Σ driveMin = 60·D/V_INTER + Σ_stops 60·det_k/V_DETOUR`, because each intermediate stop contributes 0.5 in + 0.5 out = exactly one detour. **Total drive time depends on the route's real detour km and on nothing else.**

This replaces `t_hours(d) = min(d,15)/40 + min(max(d−15,0),15)/40 + max(0,d−30)/80`, which charges *every* leg for 30 km of 40 km/h urban driving. Splitting a 100 km leg at km 40 costs 120 min under that model versus 97.5 min unsplit — **~22.5 min of phantom driving invented per additional stop**, biasing the optimizer toward fewer, deeper charges, i.e. exactly the behaviour the feature exists to prevent. `T_TERMINAL` is a constant and cancels from the argmin; add it only for display.

MyTaxi's `eta` is **discarded** — measured at exactly 20.00 and 25.00 km/h implied average on intercity legs, and non-deterministic across identical queries. Assert and log if `distance/eta < 40 km/h` on any leg > 100 km.

### 2.4 Candidate generation and the mandatory thinning step

Pipeline order matters; each step is a precondition of the next.

| # | step | effect |
|---|---|---|
| C0 | canonicalize connectors (§4.3); site-cluster at 150 m, distance-only | 630 → **1014** GB/T-DC sites ≥50 kW; 1063 rows → ~922 sites |
| C1 | **plug gate** — `standard == car.plug ∧ current == 'dc'` | feasibility, not preference (GB/T 1014 vs CCS2 111) |
| C2 | power gate — `gunKw ≥ minKw` (50) | `power===0 → null`, never 0 kW |
| C3 | live gate — drop only *fresh, per-site, all-down* (§3.5) | −212 sites (17.5%) |
| C4 | project onto polyline, keep `lateral ≤ D_MAX` (5 km) | equirectangular, `kx = R·cos(lat_mid)` once |
| C5 | forward reachability from O at `s₀`; **backward reachability from D at σ_max** | backward pass is mandatory |
| C6 | **gatekeeper (cut-vertex) pass** | see below |
| C7 | **thinning — MANDATORY** | C=638 → 24 |
| C8 | greedy upper bound `UB_greedy` → derives `K_MAX` | also the guaranteed fallback answer |

**C6 gatekeeper.** A candidate is a *bridge candidate* if the charger-free stretch immediately before or after it exceeds 60 km (≤8 such nodes on this corridor). For each, remove it and re-run forward reachability O→D; if D becomes unreachable, set `gatekeeper: true`. Cost ≤ 8·C ≈ 5k ops. Non-bridge candidates have a neighbour within 60 km on both sides and cannot be a cut vertex for any car passing the `Rp ≥ 120` input gate. Gatekeepers are **exempt from thinning and from the occupancy penalty**, and are surfaced individually in the response.

**C7 thinning.** Bucket by `progress` into 25 km buckets; keep the top **2** per bucket by `score = gunKw − 8·lateralKm`; union with all gatekeepers, both endpoints of every charger-free stretch > 80 km, and O/D. This is **not optional tuning**: measured on the real Tashkent→Qarshi corridor, the unthinned set is **C=638 at 382 ms desktop** (≈2–4 s on the Termux phone or in Hermes); thinned it is **C=24 at 14 ms**, with an **identical optimum**. Keeping 1 per bucket loses 8.4 min (2.1%) — 2 is a floor, not a knob. Thinning is the design's one heuristic; it is recorded in `optimality.thinned`.

Arc model — **complete forward DAG** (`progress_j > progress_i`), plus O→*, *→D, O→D. Skipping a station must be an *arc*, not a zero-charge label; the completeness proof in §2.6 depends on it.

### 2.5 Reserves, surcharge, label state, expansion

```
RESERVE(w)     = max(0.10·Rp, 25 km, min(d_alt(w), 0.25·Rp))   // d_alt = km to nearest other candidate
RESERVE_DEST   = max(0.15·Rp, 25 km)
GAP_SURCHARGE  = 0.05·Rp
T_PLUG         = 5 min      WAIT_MIN = 12 min      σ_max = 0.90
gapKm(v,w)     = longest sub-interval of [progress_v, progress_w] with no surviving candidate
```

`RESERVE` is isolation-aware: arriving at a charger with 25 km of buffer is fine when a backup sits 8 km away and thin when the next is 132 km ahead.

```
Label ℓ = { v, t, soc, stops, parent, chargedTo }        PQ keyed on f = t + h

expand(ℓ at v):
  for w with progress_w > progress_v (or w == D):
    e    = progress_w − progress_v + 0.5·det_v + 0.5·det_w
    need = e + (w==D ? RESERVE_DEST : RESERVE(w)) + (gapKm(v,w) > 80 ? GAP_SURCHARGE : 0)
    if need > σ_max·Rp: continue
    # (a) pass through — the only option at the origin
    if ℓ.soc >= need:
        push(w, ℓ.t + driveMin + waitMin(w), ℓ.soc − e, ℓ.stops)
    # (b) charge at v, then drive to w
    if isStation(v) && ℓ.stops < K_MAX:
        cand = { need, σ_max·Rp } ∪ { b ∈ BP_v : ℓ.soc < b < σ_max·Rp }
                                  ∪ { b + e : b ∈ BP_w, in range }      # switching sequence
        for d in dedupe(cand, 0.1 km), d > max(ℓ.soc, need):
            push(w, ℓ.t + τ_v(d) − τ_v(ℓ.soc) + T_PLUG + driveMin + waitMin(w),
                    d − e, ℓ.stops + 1)
```

The surcharge is attached to any arc **containing** a >80 km charger-free stretch, not merely to arcs that *are* one — otherwise a single-stop plan that jumps the gap silently skips the insurance a two-stop plan pays. Charging it from arc start (rather than gap entry) is conservative and O(1).

Dominance and the UB prune are applied **at push time**, not at pop; that alone is a ~20× runtime difference.

### 2.6 Why the candidate set is complete (exact)

For a fixed stop sequence with leg energies `e_i`, total charge time telescopes:

```
T = −τ₁(a₁) + Σ_{i<k} [ τ_i(d_i) − τ_{i+1}(d_i − e_i) ] + τ_k(d_k) + k·T_PLUG
```

**Separable** in the departure SoCs and piecewise-linear with breakpoints exactly in `BP_i ∪ (BP_{i+1} + e_i)`. (It is *not* convex — each bracket is a difference of convex functions — so "solve the convex subproblem" is wrong, and there is no convex solver on a Termux phone anyway.) Minimizing a separable PWL objective over the chain polytope `{d_i ≥ max(a_i, need_i), d_i ≤ σ_max·Rp}` attains its optimum at a vertex; every vertex coordinate is a breakpoint, a box bound, or an active `d_i = a_i` (zero charge at stop i). The first two are literally `cand`; the third is covered because zero-charge-at-i is the direct arc `i−1 → i+1` in the complete DAG, whose own `cand` includes `BP_{i+1} + e`. Hence enumeration is exhaustive over vertices — no grid, no error term.

Corollary: a uniform 1% SoC grid is 101 states per node versus ~18 candidates per arc — larger **and** approximate (error ≈ (Rp/S)·maxSlope ≈ 1–3 min per stop). Do not copy Google's bipartite sub-node gadget; it exists because they bake a static planetary graph offline.

### 2.7 Dominance and pruning

| rule | statement | status |
|---|---|---|
| **D1 Pareto** | at the same node, `ℓ₁ ≺ ℓ₂ ⟺ t₁ ≤ t₂ ∧ soc₁ ≥ soc₂` | exact |
| **D2 ε-quantized** | compare on `round(t·10)`, `round(soc)` | **OFF by default** |
| **D3 stop cap** | discard `stops > K_MAX`, `K_MAX = min(6, floor((UB_greedy − 60·D/V_INTER − T_TERMINAL)/T_PLUG))` | exact — a theorem |
| **D4 A\*** | `h = 60·remKm/V_INTER + max(0, remKm + RESERVE_DEST − soc)/rMaxAhead(v) + (needsCharge ? T_PLUG : 0)` | admissible |
| **D5 UB prune** | discard `f ≥ UB`; seed `UB = UB_greedy` | exact |
| **Pareto cap** | `L_MAX = 128`, per node, sorted by `t`; **instrument whether it was hit** | exact unless hit |

**D1's precondition, corrected:** D1 requires only that τ be **non-decreasing** (power > 0). It does *not* require non-increasing power. The non-increasing invariant is what **candidate completeness** (§2.6) needs. This matters operationally: when someone later adds the real cold-pack ramp-up at 0–10% SoC, dominance stays sound and the planner returns quietly sub-optimal routes with no error — so the assert message must name the completeness proof, or the wrong thing gets fixed.

**D3 is exact** because every stop costs ≥ `T_PLUG` and the optimum is bounded by `UB_greedy`; a *guessed* cap like `ceil(D/(0.65·Rp))+1` combined with (t,soc)-only dominance silently discards optima.

**k-best:** settle the first M=8 destination labels. **After the first settle, hold `UB = 1.15 × best`** — do not tighten UB to the incumbent, or every subsequent label is pruned and the planner silently returns exactly one option. Dedupe by **station set**; return ≤3 labelled *Fastest* / *Fewest stops* / *Most buffer* (max of the minimum arrival SoC across legs).

**Relax ladder** when D is unreachable — each rung re-runs C4–C8 and is reported verbatim in `relaxations[]`:
1. `D_MAX` 5 → 10 → 15 km
2. `minKw` 50 → 40
3. **STOP.** Return `feasible:false` with the blocking gap.

There is **no `minKw` 19/30 rung** — 19 kW is not a high-power DC charger (241 connectors sit there), and adding 130 km of range at 19 kW is a ~3 h stop inside a time-minimizing objective. There is **no `D_style` 0.82→0.90 rung** — every other rung trades a *data* assumption; that one trades the driver's safety margin, fires exactly when the corridor is marginal, and conjures ~28 km of range behind a banner the user nods past.

### 2.8 Objective

Minimize `t_arrival = Σ driveMin + Σ (τ_v(d) − τ_v(a)) + stops·T_PLUG + Σ waitMin + T_TERMINAL`, subject to `soc ≥ need` on every arc, `soc ≤ σ_max·Rp`, `stops ≤ K_MAX`.

### 2.9 What is exact and what is not

**Exact:** the PWL surrogate equals the CC-CV integral at every band edge; candidate-set completeness for a fixed sequence; D1; D3's cap; D4's admissibility; and — the one that matters for safety — **`need` is evaluated at exact values at expansion time, so no returned plan is ever infeasible under the model**, whatever pruning ran.

| approximation | sign | magnitude |
|---|---|---|
| PWL within a band, for `τ(d)−τ(a)` | **either** (not one-sided) | ≤ **0.43 min** per session |
| candidate thinning (2 per 25 km) | pessimistic | **0.00 min measured** (C=638 → 24); no proof |
| ε-dominance D2 (`fast=1` only) | pessimistic | compounds along the path; unbounded in principle |
| Pareto cap L_MAX | pessimistic | 0 unless hit; instrumented |
| corridor linearization | either | **+0.069%** measured over 306 km |
| detour `2·lateral·1.35` at lateral 2–15 km | either | unvalidated; verification pass (§5) covers it |
| `D_style`, `c`, user's `R` | **dominant** | CLTC overstates real range 30–45% |

Thinning, ε-dominance and the Pareto cap **cost optimality, not safety**. The bottom four rows are model-vs-reality errors and are what the reserve stack in §3.6 exists to absorb. Therefore: `optimality: { status: "exact" | "bounded" | "heuristic", chargeCurveErrorMin, paretoCapHit, thinned:{from,to} }`, and **never print "optimal" unqualified**.

### 2.10 Worked example — Tashkent → Qarshi

Inputs: `D = 453 km` (measured road), `R = 400 km`, `Pv = 100 kW`, `plug = GBT_DC`, `soc₀ = 80%`, style normal, mild. Derived: `B = 72 kWh`, **`Rp = 328` planning-km**, `s₀ = 262.4`, `rate₁ = 6.833 km/min`, `RESERVE = 32.8`, `RESERVE_DEST = 49.2`, `GAP_SURCHARGE = 16.4`, `σ_max·Rp = 295.2`. Corridor: charger-free stretch **km 321 → 453 (132 km), ending at the destination**. Both chosen stops are explicit-power 120 kW sites, so `P_eff = min(100,120) = 100 kW` and no cabinet derate applies.

Gap constraint (exact): departing km 321 requires `(132 + 49.2 + 16.4)/328 = ` **60.2%**.

**Fastest — 2 stops, 6 h 49 m** (all numbers exact under the model):

| | km | arrive | depart | charge | +plug | note |
|---|---|---|---|---|---|---|
| Origin | 0 | — | 80.0% (262.4) | — | — | |
| **Stop 1** G'allaorol Petrol 120 kW | 229.5 | **10.0%** (32.9) | **37.9%** (124.3) | 13.4 min | 5 | entirely below the knee, so full 6.833 km/min |
| **Stop 2** last site before the gap (gatekeeper) | 321.0 | **10.0%** (32.8) | **60.2%** (197.6) | 25.5 min | 5 | charges into the taper *because feasibility forces it* |
| Qarshi | 453.0 | **20.0%** (65.6) | — | — | — | 15% reserve + 5% unspent gap insurance |

Drive `= 60·453/80 + 20 = 359.8 min`. Charging `= 38.8 min`, plugs `= 10 min`. **Total = 408.6 min = 6 h 49 m.** Energy added = 256.2 planning-km ≡ 56.2 kWh into the pack.

**Alternatives returned:** *Fewest stops* — 1 stop at km 229.5, depart **88.1%**, charge 57.7 min, **7 h 02 m** (13.9 min slower: the 80→88% slice alone costs 19 min). *Most buffer* — 3 stops (adds km 130.8), min arrival SoC **30.0%**, **6 h 56 m**.

Sanity properties this example must reproduce, and which belong in the regression test: (a) 2 stops beat 1 for any `T_PLUG` ≤ 14 min; (b) no stop departs above 80% except the pre-gap one; (c) stop 2 sits at the **last** candidate before the gap — that falls out of convexity (a later stop needs a lower departure SoC, so it charges in a cheaper band), not from a special case; (d) departing 37.9% at stop 1 is *correct*, not a bug — with identical station curves the marginal rule `1/p(d_i) − 1/p(d_i − e_i) > 0` says charge the minimum at every early stop; the literature's 55–70% band applies to heterogeneous stations and higher-utilization trips. If the cabinet derate did apply at stop 2 (`gunKw = 60`), charge 2 becomes 42.4 min and the total 7 h 06 m.

---

## 3. Handling the hard cases

### 3.1 The 132 km gap that ends at the destination

There is no bail-out charger of any power inside km 321–453; arriving short is a tow, not a delay. Six mechanisms, all already in §2:

1. **Backward reachability (C5)** guarantees the pre-gap candidate is never pruned as "useless".
2. **Gatekeeper pass (C6)** identifies it as a cut vertex and **exempts it from thinning and from the occupancy penalty**.
3. **Gap surcharge** raises `need` on any arc containing the stretch — including the single-stop arc that jumps it.
4. **`RESERVE_DEST`, not `RESERVE`**, terminates the leg, since the stretch ends at the destination.
5. If the gatekeeper's status is **fresh, per-site and all-down**, return `feasible:false` naming it — never route through it. If its status is stale or unknown, route but flag.
6. The stop card says *"Last charger before a 132 km stretch with no DC. We're charging higher here on purpose."* Amber, not red — this is correct behaviour, not an error.

Required gap-entry SoC, `(132 + RESERVE_DEST + 0.05·Rp)/Rp`:

| `R` | mild (`Rp = 0.82R`) | winter (`Rp = 0.656R`) |
|---|---|---|
| 250 | 84.4% | **>100% → REFUSE** |
| 300 | 73.7% | 87.1% |
| 350 | 66.0% | 78.0% |
| 400 | **60.2%** | 70.3% |
| 475 | 53.9% | 62.4% |

Note the audits disagree on which station gates the hole (km 316 / 317 / 321, lateral 0.0 / 8.5 km). When the identity of the single most safety-critical node is disputed you need machinery, not a constant: the gatekeeper is **computed per plan**, never hard-coded, and its identity plus its lateral offset is returned.

### 3.2 GB/T vs CCS2

Connector filtering is **free** — local SQLite + geometry, before any API call — and it changes the feasible graph by ~9×: **1014** GB/T-DC sites ≥50 kW versus **111** CCS2. Measured CCS2 charger-free stretches: Qarshi **157 km**, Bukhara **228 km**, Urgench **395 km**.

**Pre-search gate:** for any `plug ≠ GBT_DC`, compute that plug's own longest charger-free stretch on the corridor. If it exceeds `σ_max·Rp − RESERVE_DEST − GAP_SURCHARGE`, refuse before searching with the numbers named: *"Only 111 CCS2 chargers exist in Uzbekistan. The Samarkand→Qarshi stretch has a 157 km gap; your car can cover 152 km with a safe reserve."* Non-GB/T is a **first-class supported car with an honest refusal**, not an unrepresentable state.

### 3.3 Inferred vs explicit DC confidence

A station whose DC-ness came from `power ≥ 43` on a bare `GB/T` string is not the same object as one whose type literally says `GB/T DC`. Two hard rules:

- **An `inferred` (or `conflict`) candidate may never be the sole feasible successor on any arc longer than ~80 km.** Implementation: for each arc `(v,w)` with `distKm > 80` and `w.confidence != 'explicit'`, require some `explicit` `w'` that also satisfies that arc's `need`; otherwise delete the arc.
- **An `inferred` candidate may never be a gatekeeper.** If the cut-vertex pass flags one, drop it and re-run. The corridor is then feasible without it, or infeasible — in which case report the blocking gap and name the station as *"unverified — we won't route you through it"*.

Everywhere else `inferred` candidates route normally and render an "unverified power" chip.

### 3.4 Missing and zero power

`power === 0 → null`, never 0 kW ("Minor masjidi" stores 0 on both connectors and would otherwise be silently excluded). 44 sites (38 Beon + 6 Tokbor) have no power on any connector: **excluded from routing**, returned in `unverified[]` for map pins only. Guessing here routes someone to a 7 kW post 100 km into the desert.

The name parser `/(\d{1,3}(?:\s*\+\s*\d{1,3})*)\s*(kw|кВт|квт)\b/gi` is a **validator, not a backfill** — it hits 71.6% of names and **0 of the 44** that need it. Its value is the 81 sites where name and connector max disagree (31 of which flip the ≥50 kW bit): take the **lower**, set `confidence: 'conflict'`, treat as `inferred` for §3.3.

Per-gun power: `connector.power` is currently a *cabinet* rating replicated onto every gun (`scrapers/apps/tokbor.ts:95-102`), and a shared 120 kW cabinet delivers ~60 kW per side when both guns are busy — a **2× error**, not a 15% one. Fix it at source; until then `gunKw = siteMaxKw / gunCount` when `cabinetSuspect` (all guns equal power, `gunCount ≥ 2`, no "A+B kW" in the name) with `confidence: 'inferred'`. A 0.85 blanket derate is not an acceptable substitute.

### 3.5 Stale and fabricated live status

A status is **usable** only if `ageSec ≤ 900` **and** it is per-**site**. Per-**gun** status is never trusted: Tokbor replicates one station-level value onto every connector, and Beon *fabricates* it positionally (`beon.ts:55` marks the first `freeConnectorsCount` guns available).

| condition | routing effect | UI dot |
|---|---|---|
| fresh + per-site + all connectors down | remove candidate (−212 sites); if gatekeeper → `feasible:false` | red |
| fresh + per-site + some busy | `+WAIT_MIN = 12` on arcs entering it; **never removal** | amber |
| fresh + per-site + available | none | **green** |
| stale (>15 min), or per-gun only, or unknown | **none** | **grey** |

**Never render a green "available" dot from cached or stale data.** Green requires fresh AND per-site AND overall-available; every other case is grey. A false green on the gatekeeper before a 132 km hole is the highest-consequence lie this app can tell. A 3–5 min-fresh snapshot is weak evidence about a stop 20–40 min in the future — occupancy is a tie-breaker, never a constraint.

### 3.6 The safety reserve

```
RESERVE(w)    = max(0.10·Rp, 25 km, min(d_alt(w), 0.25·Rp))
RESERVE_DEST  = max(0.15·Rp, 25 km)
GAP_SURCHARGE = 0.05·Rp   on any arc containing a charger-free stretch > 80 km
σ_max         = 0.90 hard
```

The 25 km floor binds only below ~250 planning-km — precisely the cars that get stranded — and matters because the national fallback layer is 241 sites at 19 kW: limping only works if you actually have ~25 km left. Buying insurance **only where model error is unrecoverable** (the surcharge) rather than inflating the global derate is deliberate: because τ is convex, a margin that pushes charging past ~75% costs disproportionate *time*, so a uniform derate makes the planner slow everywhere to solve a problem that exists in one place.

`D_style` is **never** relaxed to manufacture feasibility. If a trip is only possible at 0.90, it is only possible if the driver holds a speed they have not agreed to — surface it as a per-leg speed *constraint* printed on the itinerary, or refuse.

Double-counting guards: UI copy pins `R` to "what you actually see in mild weather, mostly highway", so `D_temp` is not applied on top of a winter-measured number; `η` is a flat multiplier on power and is **not** additionally degraded above 80%, because the taper already encodes that loss.

---

## 4. Data model

### 4.1 Garage (client-side only; no accounts, no server-side user rows)

`apps/mobile/lib/vehicles/garage.ts`, AsyncStorage key `voltai.garage.v1` via the existing `lib/storage/jsonStorage.ts`. **No zustand, no MMKV, no expo-sqlite.**

```ts
type Plug = 'GBT_DC' | 'CCS2' | 'CCS1' | 'NACS' | 'CHADEMO';
type SavedCar = {
  id: string;
  label: string;                                  // "BYD Han"
  rangeKm: number;                                // real-world at 100%, mild, mostly highway
  rangeSource: 'observed' | 'sticker';            // 'sticker' ⇒ ×0.72 applied on save
  plug: Plug | null;                              // null ⇒ car is NOT plannable
  dcPeakKw: number;                               // default 90 unknown GB/T, 100 unknown
  consWhKm: number;                               // default 180
  curvePreset: 'lfp' | 'standard' | 'peaky';      // k = 2.0 | 1.8 | 1.3
  isPhev: boolean;
  createdAt: string; updatedAt: string;
};
type Garage = { cars: SavedCar[]; selectedCarId: string | null; schema: 1 };
```

**Plug is an unskippable enum prompt.** The installed `lib/vehicles/vehicleProfile.ts` is `{make, model, rangeKm}` with **no plug field**, so the one-shot migration from `voltai.vehicleProfile.v1` must seed `plug: null`, not `'GBT_DC'`. A `null` plug blocks planning entirely: the Garage screen shows a blocking picker on next open, and `/plan` refuses with `reason: 'plug-required'`. Defaulting to GB/T routes a Tesla or Kona owner through physically incompatible chargers on a corridor whose 132 km gap ends at the destination — a stranding bug introduced through the back door, in a design that otherwise argues this exact point correctly.

Input hygiene, enforced at save: `rangeKm > 600` prompts *"spec sheet, or what you actually see?"* → `sticker` applies ×0.72 (CLTC overstates 30–45%); `rangeKm > 700` or a label matching `/chazor|dm-i|dmi|phev|plug-?in hybrid/i` blocks saving as a BEV (BYD Chazor is a DM-i hybrid, 8.3/18.3 kWh; "1200 km" derives a fictitious 216 kWh pack and a zero-stop plan). Always echo derived values back: *"assuming ~18 kWh/100 km, ~72 kWh pack, 100 kW max, ~328 km planning range."*

### 4.2 New SQLite tables

All inside `SCHEMA_SQL` in `src/db/schema.ts` (`db.exec()`'d on every open ⇒ `IF NOT EXISTS` mandatory; a sidecar `.sql` file will not survive `tsc`). There is no migration runner, so **no `ALTER TABLE`** — site ids live in a side table.

> **What actually shipped (2026-08-16):** only `route_cache`, and with a smaller shape than drawn
> below — `(k, provider, distance_m, polyline, fetched_at)`, key `"olat,olng->dlat,dlng"` at 3 dp,
> no `waypoints`/`hits` columns. **`plan_corridor`, `station_sites` and `plan_log` do not exist**;
> nothing is logged per plan (no PII, and no request log at all). `pruneRouteCache()` in
> `mytaxi.ts` runs once per scrape cycle: it deletes rows past the 90-day TTL and re-validates a
> bounded slice (100 rows/cycle, cursor wraps) of the rest against their own key, so geometry
> written before validation existed is weeded out over a few cycles. The design below is kept
> for the reasoning; treat the DDL as a proposal.

```sql
CREATE TABLE IF NOT EXISTS route_cache (
  k          TEXT PRIMARY KEY,      -- provider|"olat,olng|dlat,dlng" each toFixed(3) ≈110 m
  waypoints  TEXT,                  -- JSON [[lat,lng],…] for verification routes
  distance_m INTEGER NOT NULL,
  polyline   TEXT NOT NULL,         -- Google encoded, PRECISION 5 (divisor 1e5)
  provider   TEXT NOT NULL,         -- 'mytaxi' | 'synthetic'
  fetched_at TEXT NOT NULL,
  hits       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_route_cache_fetched ON route_cache (fetched_at DESC);

CREATE TABLE IF NOT EXISTS plan_corridor (
  id TEXT PRIMARY KEY, label TEXT NOT NULL,
  o_lat REAL NOT NULL, o_lng REAL NOT NULL, d_lat REAL NOT NULL, d_lng REAL NOT NULL,
  route_key TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS station_sites (
  station_id TEXT PRIMARY KEY, site_id TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_station_sites_site ON station_sites (site_id);

CREATE TABLE IF NOT EXISTS plan_log (               -- no PII; pruned to 5000 rows per merge
  id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, corridor_id TEXT,
  plug TEXT, range_km INTEGER, soc_pct INTEGER, stops INTEGER, total_min INTEGER,
  exact INTEGER, geometry TEXT, relaxed TEXT, ms INTEGER
);
```

Route distance is deterministic (verified bit-identical across calls) ⇒ 90-day TTL. 8 KB × 1000 corridors = 8 MB beside a 2.43 MB DB. Bind values may only be `number|bigint|string|Uint8Array|null|boolean`; no `db.transaction()` helper — hand-roll `BEGIN IMMEDIATE`.

Site clustering: distance-only union-find at **150 m, name similarity dropped entirely** — cross-source duplicates are exactly the case where names differ ("NORMA 120kW" vs "Elektroapparat 120 kW"), and today only 3 of 1211 stations have >1 source. Rows are not deleted (the map keeps each operator's brand); the planner expands one *site* node, so it can never propose five stops in one Qamchiq parking lot.

### 4.3 Connector canonicalization

`apps/api/src/services/connectorNormalizer.ts`, pure, called from **both** connector-copy sites in `mergeService.ts` so the canonical table stores it and every consumer inherits. Additive keys only — `type`/`power` untouched, so the existing wire contract holds.

| raw `type` | rows | condition | `standard` | `current` | `confidence` |
|---|---|---|---|---|---|
| `GB/T DC` | 198 | — | GBT_DC | dc | explicit |
| `GB/T AC` | 15 | — | GBT_AC | ac | explicit |
| `CCS2` | 114 | — | CCS2 | dc | explicit |
| `CCS1` | 13 | — | CCS1 | dc | explicit |
| `CCS` | **1** | — | CCS2 | dc | inferred |
| `NACS` | 7 | — | NACS | dc | explicit |
| `CHAdeMO` | 1 | — | CHADEMO | dc | explicit |
| `Type 2` / `Type 1` | 7 / 3 | — | TYPE2 / TYPE1 | ac | explicit |
| `GB/T` | 1721 | `category ∈ {dc, ultra}` | GBT_DC | dc | inferred |
| `GB/T` | | `category = ac` | GBT_AC | ac | inferred |
| `GB/T` | | `category = hybrid ∧ kW ≥ 43` | GBT_DC | dc | inferred |
| `GB/T` | | `category = hybrid ∧ kW < 43` | GBT_AC | ac | inferred |
| `GB/T` | | no category ∧ `kW ≥ 43` | GBT_DC | dc | inferred |
| `GB/T` | | no category ∧ `0 < kW < 43` | GBT_AC | ac | inferred |
| `DC` | 6 | kW null | UNKNOWN | dc | unknown |
| `unknown` | 274 | — | UNKNOWN | null | unknown |

Bare `GB/T` is **not a plug type** — GB/T AC is 7-pin and GB/T DC is 9-pin, physically non-interchangeable. Resolution: **2182/2360 = 92.5%**; 176 (all Beon) irreducibly unknown. `power === 0 → null` throughout.

`gunKw`: `count == 1` → `siteMaxKw`; name encodes "A+B kW" with as many numbers as guns → i-th number (`explicit`); `cabinetSuspect` → `siteMaxKw/gunCount` (`inferred`); name/connector max conflict → `min(...)` (`conflict`); no power anywhere → `null`, excluded from routing.

Also **export** `maxPower()` / `deriveCategory()` from `src/db/mappers.ts`; note `deriveCategory`'s ≥43 kW threshold is *not* the planner's definition (`minKw`, default 50).

---

## 5. API design

> **Superseded — read this box first (2026-08-16).** The wire contract is the `PlanResponse` /
> `PlanOption` types in [`apps/mobile/lib/plan/planClient.ts`](../../mobile/lib/plan/planClient.ts),
> which mirror `src/routes/plan.ts` field for field. The JSON example further down was the design
> sketch and differs from what shipped (`optimality`, `legs`, `effectiveKw`, `statusFresh`,
> `fromSiteId`, `socNeededPct` … were never emitted; `arrive`, `opts`, `fast` are not read).
> What the endpoint actually does today:
>
> - **Validation, before any work (400 with `{message, field, reason}`):** `from`/`to` must be
>   `lat,lng` (`invalid-origin` / `invalid-destination`) **and inside the service area** — a
>   generous Central-Asia box, lat 35–48 × lng 52–76 (`outside-service-area`); `range` 50–1200
>   (`invalid-range`); `soc` 1–100 (`invalid-soc`); `plug` required and routable
>   (`plug-required` / `unsupported-plug`); optional knobs are refused, not clamped, when present
>   and out of range: `dcKw` 10–400, `consWhKm` 80–500, `minKw` 0–400, `maxDetourKm` 0–30
>   (`invalid-dcKw` etc.). Absent knobs default to 90 / 180 / 50 / 5.
> - **Per-IP token bucket** keyed on `req.ip` (= `CF-Connecting-IP` behind cloudflared, because
>   `app.ts` sets `trust proxy` to loopback): `PLAN_RATE_PER_MIN` (default 20) requests per minute
>   per IP, bucket size = the same number. Over it → **429** with `Retry-After` and
>   `{message, code:'rate-limited'}`. Checked before parsing, so a flood costs one Map lookup.
> - **Concurrency shed:** `PLAN_MAX_INFLIGHT` (default 2) → **503** + `Retry-After: 2` +
>   `{message, reason:'busy'}`. The handler yields to the event loop once (`setImmediate`) between
>   incrementing the counter and the synchronous solve, so concurrent arrivals actually see it.
> - **There is no compute budget, no `optimality.status="heuristic"` fallback and no `plan_log`.**
>   The solve runs to completion (~50 ms desktop / a few hundred ms on the phone).
> - **Geometry:** MyTaxi (validated — see §5 routing notes below) or, on any routing failure, a
>   straight line × 1.3 flagged `geometry:"estimated"`, `geometryTrusted:false`, `routingError`
>   set and `polyline:null`.
> - **Caching:** ETag tag = the quantized tag below **plus the geometry state** (`routed` vs
>   `estimated`), so a client holding an estimated answer gets a fresh 200 once routing recovers,
>   and a client that still holds the routed answer for the same data version gets a 304 while
>   routing is down (its copy is exactly what we would recompute). Degraded answers are sent with
>   `public, max-age=0, s-maxage=30` — no `stale-if-error`, no `Last-Modified` — so a guessed
>   answer is never pinned at the edge for a week the way a good one deliberately is.
> - **Itinerary arithmetic:** each option reports `totalMin`, `driveMin`, `chargeMin`, `plugMin`,
>   `waitMin` (modelled queueing at busy sites, 12 min per non-gatekeeper busy stop) and
>   `terminalMin` (20, city exit + entry), and `totalMin == driveMin + chargeMin + plugMin +
>   waitMin + terminalMin` to rounding. `driveMin` is time in motion only.
> - `blockingGap.reason` names the plug as a driver reads it (`GB/T`, `CCS2`, `CHAdeMO` …), while
>   `vehicle.plug` stays the wire code (`GBT_DC`).
> - `GET /api/plan/health` returns `{status, inflight, maxInflight, ratePerMin, trackedIps,
>   lastMergeAt, routing:{configured, breakerOpen, breakerOpensInSec, consecutiveFailures,
>   minuteUsed/Limit, dayUsed/Limit, cachedRoutes, negativeCached}}` — no `p95PlanMs`, no
>   `abortedByBudget`.

Mount in `src/app.ts`: `app.use("/api/plan", planRouter)` after the `/ingest` mount and **strictly before** the 4-arg error middleware. Do not import `scrapers/*` (pulls Puppeteer onto the request path).

**GET, not POST.** `applyCache()` implements only conditional GET, and Cloudflare will not cache a POST — on a single-phone origin already stalled ~6 s desktop-equivalent per merge, a POST puts a fresh computation on that CPU for every retry and back-navigation.

```
GET /api/plan?from=41.2995,69.2401&to=38.8606,65.7890&range=400&soc=80&plug=GBT_DC
             &dcKw=100&consWhKm=180&curve=standard&style=normal&temp=mild
             &arrive=15&minKw=50&maxDetourKm=5&opts=3&live=1[&fast=1]
```
400 on any missing/unparseable required param (`from,to,range,soc,plug`) **before** any work. `plug` has no default; omitting it is a 400 with `reason:'plug-required'`.

```jsonc
{
  "dataAsOf": "2026-08-13T09:12:44Z", "statusAgeSec": 91,
  "feasible": true,
  "geometry": "routed",                       // routed | cached | corridor | estimated
  "optimality": { "status": "exact", "chargeCurveErrorMin": 0.9,
                  "paretoCapHit": false, "thinned": { "from": 638, "to": 24 },
                  "notes": ["candidate thinning applied (2 per 25 km)"] },
  "relaxations": [],
  "vehicle": { "rangeKm": 400, "planningRangeKm": 328,
               "assumed": { "consWhKm": 180, "packKwh": 72, "dcPeakKw": 100, "curve": "standard" } },
  "options": [{
    "id": "fastest", "label": "Fastest",
    "totalMin": 408.6, "driveMin": 359.8, "chargeMin": 38.8, "plugMin": 10,
    "distanceKm": 453.0, "arriveSocPct": 20.0, "stops": 2,
    "legs": [{ "fromIdx": -1, "toIdx": 0, "distanceKm": 229.5, "driveMin": 172.1,
               "arriveSocPct": 10.0, "gapKm": 0, "polyline": "…" }],
    "chargingStops": [{
      "siteId": "68a1…", "stationIds": ["68a1…"], "name": "G'allaorol Petrol 120 kW",
      "operatorId": "tokbor", "lat": 40.05, "lng": 67.60,
      "progressKm": 229.5, "lateralKm": 0.1, "detourKm": 0.2,
      "arriveSocPct": 10.0, "departSocPct": 37.9, "chargeMin": 13.4,
      "gunKw": 120, "effectiveKw": 100, "gunCount": 2,
      "kmPerHourAtArrival": 410, "powerConfidence": "explicit",
      "liveStatus": "available", "statusFresh": true, "statusPerSite": true,
      "gatekeeper": false, "flags": [], "warnings": []
    }],
    "geometry": { "polyline": "…", "source": "mytaxi" }
  }],
  "unverified": [ /* unknown-power / unresolvable-plug sites — map pins only, never routed */ ],
  "blockingGap": null
}
```

Infeasible:
```jsonc
{ "feasible": false, "options": [],
  "blockingGap": { "fromSiteId": "…", "fromName": "…", "fromKm": 321, "toKm": 453,
                   "gapKm": 132, "endsAtDestination": true,
                   "socNeededPct": 84.4, "socAvailablePct": 78.0,
                   "reason": "Your car can't cover the 132 km stretch between Samarkand and Qarshi, even charged to 90%." },
  "suggestions": ["Try 'relaxed' driving style", "A car with ≥300 km real range makes this trip"] }
```

**Caching** — the conditional-GET check runs after the (cheap, cached) geometry lookup and before candidates/solve, because the ETag encodes whether geometry is real or estimated; on a routed answer it is `applyCache` exactly as on `/statuses`. Degraded answers use `PLAN_CACHE_DEGRADED` (`max-age=0, s-maxage=30`, no swr/sie) instead of the table below.

| endpoint | maxAge | sMaxAge | swr | **sie** |
|---|---|---|---|---|
| `/api/plan` (`live=0`) | 120 | 600 | 3600 | **604800** |
| `/api/plan` (`live=1`) | 30 | 60 | 120 | 3600 |
| `/api/plan/pack` | 3600 | 21600 | 86400 | 2592000 |

`stale-if-error=604800` is the most important line in the file: the origin is a phone. The `live=1` variant gets its **own shorter policy** rather than shortening the base — mirroring the existing `STATUSES_CACHE` / `LIST_CACHE` split.

ETag tag, quantized (the cache-hit strategy on a public, unauthenticated endpoint; the throttle is the per-IP bucket described in the box above):
```
pl-${lastMergeAt}-${olat.toFixed(3)},${olng.toFixed(3)}-${dlat.toFixed(3)},${dlng.toFixed(3)}
   -${round(range/10)*10}-${round(soc/5)*5}-${plug}-${dcKw}-${curve}-${style}-${temp}
   -${arrive}-${minKw}-${live}
```
Plus `lastModified: lastMergeAt` (routed answers only) and a trailing `-routed` / `-estimated` geometry element (see the box at the top of §5). Shipped as: `PLAN_MAX_INFLIGHT = 2` → 503 + `Retry-After: 2`; per-IP bucket `PLAN_RATE_PER_MIN` = 20/min on `req.ip` (`trust proxy` is set, so this is `CF-Connecting-IP`) → 429. ~~per-IP bucket 30/min, 300/h~~ ~~hard compute budget 250 ms → return the greedy plan with `optimality.status = "heuristic"`~~ — **not implemented; there is no compute budget and no `optimality` object.**

**Companion endpoints:** `GET /api/plan/pack?plug=GBT_DC&minKw=50` — **NOT DONE (v2)** — plannable sites + the 14 seeded corridor polylines + curve/consumption constants, ~210 KB raw / ~60 KB gzipped, generated at build time into `apps/mobile/assets/plan-pack-seed.json`. `GET /api/plan/health` — implemented as described in the box at the top of §5 (inflight, limiter, MyTaxi breaker + budget + cache counts); ~~`p95PlanMs`, `abortedByBudget`~~ do not exist. `/api/stations/statuses` is reused unchanged.

**Routing-API call budget** (`MYTAXI_API_KEY` server-side only; env via `src/env.ts` — `MYTAXI_BASE_URL`, `MYTAXI_TIMEOUT_MS` (default 2500, floor 500), `MYTAXI_RATE_PER_MIN` (20) and `MYTAXI_RATE_PER_DAY` (400), both floor 1, blank = default; breaker opens for 5 min after 3 **5xx / network / timeout** failures — a 4xx is a verdict on the pair, not an outage, and does not count; single-flight per cache key; **every 'success' body is validated before it is used or cached**: the polyline must decode to ≥ 2 in-range points, start within 25 km of `from` and end within 25 km of `to` (the provider snaps rural pins to the nearest road — a real cached row was snapped 13.6 km), and measure within ±15 % (min 1 km) of the reported distance — measured error on the real fixture is 0.07 %, so this never fires on genuine geometry but catches truncation, wrong units and a polyline for some other pair. Rejections and provider 4xx are remembered per key for 10 minutes so retries do not spend budget; cached rows are re-validated on read and by `pruneRouteCache()`):

| scenario | calls |
|---|---|
| one of 14 named corridors | **0** |
| `route_cache` hit (3 dp key) | **0** |
| cold corridor | 1 |
| verification of the *Fastest* option only | ≤1 |
| **worst case, cold** | **2** |
| naive pairwise matrix at C=57 | 1710 |

**Verification rules.** Only the Fastest option; include as waypoints only stops with `lateral < 2 km` (measured: a 6-waypoint request with pulled-off points returned 491 km vs 454 km direct — waypoint snap-and-detour inflation); assert `progress` strictly increasing (MyTaxi does not reorder); reconcile the verified total against the base corridor and **reject the correction if it disagrees by >3%**. On any routing failure: `haversine × 1.30`, `geometry: "estimated"`, and **do not emit stop-level SoC promises** on synthetic geometry — return the ETA as a range and raise `GAP_SURCHARGE` to `0.10·Rp`. Remove `EXPO_PUBLIC_MYTAXI_API_KEY` from mobile env and every `eas.json` profile.

**Deployment prerequisite:** `/api/plan` cannot ship on Vercel — `node-sqlite3-wasm` loads its binary via `readFileSync(__dirname + "/…wasm")`, untraced by `@vercel/node`, and `getDb()` mkdirs into a read-only FS with no DB shipped. Finish the Cloudflare-tunnel cutover per `RUNBOOK.md §4`, delete `vercel.json` and `api/index.ts` per `ARCHITECTURE.md §7`, and add Cache Rules for `/api/plan*` with `stale-if-error` honored — without that rule the degraded tier does not exist.

---

## 6. Mobile design

### 6.1 Route rendering — definitive answer

**Yes. `expo-yandex-mapkit`'s `lite` flavor exports a working `Polyline`.** It is exported at `node_modules/expo-yandex-mapkit/src/index.ts:25`, and the Kotlin view is registered in the **core** native module (`ExpoYandexMapKitModule.kt:396-427`) over `com.yandex.mapkit.map.PolylineMapObject` — a base MapKit class, not part of the full-flavor Transport/Search modules. The package's own capability table marks *"Map rendering, markers, polylines/polygons"* as ✓ on lite. **No flavor change, no prebuild, no native rebuild.** Only `findRoutes` / `searchText` / `suggest` / geocoding / offline require `full`.

```tsx
<YandexMapView ref={mapRef} nightMode={colorScheme === 'dark'} mapPadding={…} showUserPosition>
  <Polyline points={decoded} strokeColor={c.tint} strokeWidth={6}
            outlineColor={c.background} outlineWidth={2} zIndex={5} />
  {stops.map(s => <Marker key={s.siteId} point={s} source={markerImage(...)} />)}
</YandexMapView>
```
`Polyline` and `Marker` are **direct children** of the map view, never inside `<Clusterer>` (which collects Markers). `PolylineProps.points` is `Point[] = {latitude, longitude}[]` — structurally identical to the app's `LatLng` and to the decoder's output, so no adapters. Frame with `mapRef.current?.fitMarkers(routePoints, { edgePadding })`. Synthetic geometry uses the same component with `dashLength`/`gapLength`.

**Fallback if a future SDK bump removes it:** degrade to markers-only — numbered stop pins via the existing `markerImage()` pipeline plus a chain of ~230 small translucent dot `Marker`s sampled every ~2 km from the decoded polyline (acceptable on a second, unclustered map instance), and keep the full itinerary in the sheet. Do not switch the pinned flavor: it is set in **two** places that must agree (`app.config.ts` plugin options and `android/gradle.properties:65`).

No encoded-polyline decoder exists in `node_modules`; hand-write `lib/routing/polyline.ts` (~25 lines, precision 5, **divisor 1e5 not 1e6**).

### 6.2 Screens and navigation

Root `Stack` routes, **not tabs** — the floating pill is icon-only with 26 px padding per item (~78 px each), so a third tab reshapes the design and would require edits in both `components/floating-tab-bar.tsx` `ICONS` and the closed `MAPPING` union in `components/ui/icon-symbol.tsx`.

```
app/garage/index.tsx      saved cars, default selector, delete
app/garage/[id].tsx       add / edit  (plug picker is REQUIRED, no default selection)
app/plan/index.tsx        trip input
app/plan/results.tsx      own map + Polyline + itinerary sheet
```
Register `<Stack.Screen name="garage" | "plan" options={{headerShown:false}} />` in `app/_layout.tsx` after line 58; `unstable_settings.anchor='(tabs)'` already pops back to the tab shell.

**Entry points.** (1) A third 46×46 FAB in `styles.fabColumn` (`app/(tabs)/index.tsx:357`) above `<FilterFab/>`, identical chrome (`c.chrome` / `c.chromeBorder` / `c.chromeShadow`, MaterialIcons `alt-route` size 20 in `c.chromeIcon`), `router.push('/plan')`; the column already has `gap:10`. (2) Settings: replace the inline "Your EV" form at `app/(tabs)/explore.tsx:147-204` with a "Your cars" Section pushing to `/garage`; delete the `make`/`model`/`rangeKmText` state and the `loadVehicleProfile` effect. Keep `paddingBottom: insets.bottom + 96`.

**Input screen** reuses the Section/card/input/button conventions from `explore.tsx:31-42, 256-308`: car picker (with derived assumptions echoed back), starting-charge slider in 5% steps, origin ("My location" default), destination from the 14 corridor cities + `GET /api/stations/search?q` + map-tap (MapKit `suggest`/`geocode` are full-flavor only), three-way driving-style control, winter chip, "arrive with at least ___%" slider (default 15, range 5–30). **Never expose a raw derate percentage.**

**Results screen**: own `<YandexMapView>` instance (far cheaper than the tab map's ~1000 clustered markers, and it leaves untouched the load-bearing invariant from commit `818e365` that the tab map's `markers` memo depends only on `stationGroups`). `@gorhom/bottom-sheet` over it (`station-bottom-sheet.tsx:150-160` conventions, `paddingBottom: insets.bottom + 88`), segmented switch across ≤3 options. Stop cards show operator branding (`lib/operators.ts`), category color (`lib/categories.ts`), **km of range per hour rather than kW** (*"adds ~410 km/h at arrival"* — the same 120 kW gun gives 720 km/h at 20% and 259 km/h at 80%, which is the one-line explanation for departing at 60% instead of 90%), the SoC-vs-time sparkline, the effective power (*"100 kW — your car's limit"*), and honesty chips: `unverified power`, `shared cabinet — may be slower if busy`, `hours unknown` (`working_hours` is 100% NULL across all four sources — do not build a parser), `status 4 min old`. A tappable *why this plan* row: *"We leave each charger the moment it slows down below what the next one gives you."* Amber gap banner on any leg crossing a known hole. Also warn which operator app each stop needs **before departure** — an account you cannot create at km 321 is functionally a dead charger.

### 6.3 State and persistence

Two Contexts mounted inside `<ThemeProvider>` in `app/_layout.tsx`, copying `lib/theme/theme-context.tsx` exactly (cancelled-guard hydration, `void save(next)`, throwing `useX()` + non-throwing `useXOptional()`):

- `lib/vehicles/garage-context.tsx` → `{ cars, selectedCar, isLoaded, addCar, updateCar, removeCar, selectCar }`
- `lib/planner/pack-context.tsx` → `{ pack, packAge, source: 'seed'|'network'|'cache', refresh() }`

Keys: `voltai.garage.v1`, `voltai.planPack.v1`, `voltai.plans.v1`. `apps/mobile/store/` is Play Store listing material, not application state; `TECHNICAL_ARCHITECTURE.md`'s zustand mention is stale. Pure modules — `lib/planner/{curve,corridor,solve,types}.ts` — carry no React, no I/O, so they run headless and share the server's solver semantics. Pack refresh: on first planner open, then at most weekly, `If-None-Match`, 10 s timeout, silent failure.

Every generated plan is persisted **fully materialized including the polyline**, because the 132 km gap is exactly where cell coverage is worst; a trip in progress must not evaporate.

### 6.4 Degraded modes — and the mock-data rule

| tier | condition | behaviour |
|---|---|---|
| T0 | API up | live plan; footer *"Live data · updated 1 min ago"* |
| T1 | phone down, edge warm (<7 d) | edge serves under `stale-if-error`; amber footer with data date; **status dots grey** |
| T2 | no usable response | local solve from the pack; real plan; dashed geometry + ETA **range** if the corridor is not one of the 14; grey dots; Retry pill |
| T3 | pack unreadable | explicit empty state + *Download planner data (210 KB)* + *Open last plan*; never a bare error or a spinner |

T3 is near-impossible on a fresh install because the seed pack is bundled in the binary — which matters, since `api.voltai.uz` returns 500 today.

**The planner fails closed on fixture data.** `listStations()` returns `{ stations, source: 'api' | 'mock' }` and falls back through AsyncStorage to `apps/mobile/data/mock-stations.ts` (six invented Tashkent-area stations with fabricated CCS2/Type 2 connectors and a "VoltAI" operator). The planner **must refuse** when `source === 'mock'` — a 453 km desert itinerary computed against invented chargers is the worst possible output of this feature. Refuse with the reason shown, and surface catalog age whenever `source !== 'api'`. Surface the existing `useIsOffline` banner on both planner screens. Requires a dev-client/EAS build (native module; not Expo Go). New theme tokens must be added to `ThemeColors` **and both** `Colors.light`/`Colors.dark`; prefer `c.tint` / `c.accent` / `c.statusAvailable` over the stray hardcoded `'#22E06B'`. No i18n library — zero infrastructure exists and zero source files contain Cyrillic.

---

# Phasing, blockers and open questions

between `/api/plan` answering in 60 ms and appearing to hang.

### v1 — Shippable and useful (~17 days)

**Server (~10 d)**

| # | work | files | effort |
|---|---|---|---|
| 1 | Connector normalizer + `Connector`/`StationWire` type widening + wiring into **both** `mergeService` copy sites + name-power validator + `power===0 → null` | `src/services/connectorNormalizer.ts`, `src/types/station.ts`, `src/db/mappers.ts`, `src/services/mergeService.ts` | 1.5 d |
| 2 | Tokbor per-gun power fix + `siteMaxKw` + `sharedCabinet` flag | `scrapers/apps/tokbor.ts:95-102` | 0.5 d |
| 3 | Corridor-local 1 km site dedupe inside the planner (the global 150 m union-find + `station_sites` moves to v2) | `src/services/planner/corridor.ts` | 0.25 d |
| 4 | Charge curve — log-mean band table, `τ`, `BP`, `assertNonIncreasing`, 3 presets, vehicle catalog, consumption/DC-cap tables | `src/services/planner/chargeCurve.ts`, `vehicleCatalog.ts` | 1 d |
| 5 | Corridor — precision-5 decode, prefix sums, equirectangular projection with a 0.05° segment grid, arc/detour model | `src/services/planner/corridor.ts` | 1 d |
| 6 | MyTaxi client + `route_cache` + `plan_corridor` + token bucket + circuit breaker + `eta < 40 km/h` assertion + seed the 14 corridors | `src/services/routing/*`, `src/db/schema.ts` | 1.5 d |
| 7 | Planner — P1–P9 incl. gatekeeper pass, relax ladder, label search with D1/D3/D4/D5/D6, k-best | `src/services/planner/planner.ts` | 2.5 d |
| 8 | `GET /api/plan` + `/api/plan/health` + caching + token bucket + `MAX_INFLIGHT` + `.env.example` + README + RUNBOOK | `src/routes/plan.ts`, `src/app.ts` | 1 d |
| 9 | Regression harness (§7.1) | `scripts/plan-check.ts`, `package.json` | 1 d |

**Mobile (~7 d)**

| # | work | files | effort |
|---|---|---|---|
| 10 | Garage — model, context, 2 screens, **plug prompt on migration**, PHEV/CLTC guards, Settings rewire | `lib/vehicles/*`, `app/garage/*`, `app/(tabs)/explore.tsx`, `lib/storage/storageKeys.ts` | 2.5 d |
| 11 | Polyline decoder + `planClient` + `planHistory` (materialized) | `lib/routing/polyline.ts`, `lib/plan/*` | 1 d |
| 12 | `/plan` input screen + the third map FAB | `app/plan/index.tsx`, `app/(tabs)/index.tsx` | 1.5 d |
| 13 | `/plan/results` — own map, `<Polyline>`, stop markers, `fitMarkers`, bottom sheet, honesty chips, gap banner, infeasible state | `app/plan/results.tsx` | 1.5 d |
| 14 | `/plan/history`, offline empty states, remove `EXPO_PUBLIC_MYTAXI_API_KEY` from mobile env | `app/plan/history.tsx`, `.env.example` | 0.5 d |

**v1 total ≈ 17 engineer-days ≈ 3.5 calendar weeks solo.**

**v1 scope boundaries, stated so review can enforce them:** GB/T DC only as a routable plug (others get an explicit refusal); `minKw` 50 with the ladder to 40; `D_MAX` 10 km with the ladder to 30; `D_temp` manual winter toggle; 24/7 hours assumed with a caveat chip; live status as site-alive filter + `+12 min` occupancy penalty; up to 3 options; ε-dominance off; **zero verification routing calls**; server-side solver only.

#### 7.1 Tests to write **first**

Six assertions in `scripts/plan-check.ts`, run by `npm run api:lint` alongside `tsc --noEmit`:

1. **Tashkent → Qarshi, R=400, Pv=100 kW, start 80%** → exactly **2 stops**, first departing 35–55%, last departing 58–70% immediately before the gap, total 6 h 40 m – 6 h 55 m. If anything charges above 80% other than before a gap, `T_PLUG` or the curve is mis-tuned. If it charges to 90% where 61% suffices, `need` is missing from `cand`.
2. **One-stop must be strictly worse** — assert the returned Fastest beats the best 1-stop plan by 8–14 min. This is the test that proves the taper is actually driving stop selection.
3. **R=250 in winter** → `feasible: false` with a populated `blockingGap`, **not** a route.
4. **Gatekeeper outage** — mutate the status feed to mark the sole pre-gap site offline → response names it explicitly and refuses.
5. **Greedy trap** — 200 kW at km 150 vs 60 kW at km 200, R=300 → the planner takes the near fast charger and charges higher, beating greedy by ~25 min.
6. **`assertNonIncreasing`** — feed a curve with a 0–10% cold-pack ramp; module load must throw.

Plus a decode round-trip against a recorded MyTaxi response fixture, and a check that `τ(0.90) − τ(0.50)` from the band table equals `B/(η·P·k)·ln(5)` to within 0.01 min.

### v2 — Calibration, honesty, offline (~9 days)

Strict priority order.

| # | work | effort | why here |
|---|---|---|---|
| 1 | **Learned per-car calibration** — capture actual arrival SoC after a trip, EWMA-correct `D_style` per car | 1 d | ~30 lines, and it beats every physics term combined. The 0.82 default is a defensible estimate, not a measurement of Uzbek roads |
| 2 | **Charging-session logging** (arrival SoC, departure SoC, elapsed, site, gun kW) to fit real curves and calibrate `T_PLUG`/`WAIT_BUSY` | 1 d | These are guesses that flip the stop count |
| 3 | **Extract `packages/planner-core/`** — pure, dependency-free; `apps/api` via a tsconfig path mapping, Metro via `watchFolders` | 1.5 d | Prerequisite for #4. Deliberately *after* the constants are calibrated, so we are not syncing a moving target |
| 4 | **Offline planning** — `GET /api/plan/pack` (~210 KB, 60 KB gzipped: sites + 14 corridor polylines + gaps + constants), a build-time seed asset bundled in the binary, client solve with grey status dots, dashed synthetic geometry, ETA as a range | 2 d | Fresh install plans with the backend dead |
| 5 | **`D_temp` from Open-Meteo** at leg midpoints, cached in SQLite at 3 dp (measured 3 requests / 342 ms per corridor; free tier 10k/day, non-commercial) | 1 d | Temperature is a bigger effect than speed and far bigger than elevation |
| 6 | **Global site clustering** — 150 m grid union-find, name similarity dropped, `station_sites` table | 1 d | Fixes the Qamchiq-pass five-rows-one-site problem everywhere, not just on-corridor |
| 7 | **Verification routing**, gated on all stops having lateral < 2 km, with a 3% divergence rejection | 0.5 d | See §5.5 on waypoint pull-off |
| 8 | **Beon scraper honesty** — stop fabricating positional gun availability; emit `count` + `freeCount` | 0.5 d | |
| 9 | **ORS fallback provider**, wired and exercised in CI — *not* discovered during an outage | 0.5 d | But sanity-check its geometry: ORS is OSM-backed and OSM covers ~24% of Uzbek road length with documented gaps around Samarkand and Qarshi |

### v3 — Only if data or usage demands it (~8 days)

- **Measured per-car charge curves** from logged sessions. The architecture already stores curves as `(σ, kW)` breakpoints, so real curves drop in with zero code change.
- **Alternative base routes** when the relax ladder still fails, so "impossible" is never concluded from a single polyline.
- **Gated elevation** — only when a leg's sampled max exceeds both endpoints by > 400 m. That fires on the Takhtakaracha pass (1788 m) toward Shahrisabz and essentially nowhere else; the main corridor's total elevation contribution is +3.2%, with only 3.5% disagreement between the cheap and expensive models. Rule of thumb for the code comment: 1 m of net climb ≈ 0.04 km of range.
- **CCS2 planning**, gated on the network actually growing past ~250 sites. This is not a code problem.
- **Price-aware option** ("Cheapest") — `pricePerKwh` exists on 1626/2360 connectors, but the requested objective is time; ship it as a fourth option only if users ask.
- **Multi-day trips / overnight AC** — different problem, different UI.

---

## 8. Prerequisites and blockers

Ordered by what stops work.

**8.1 — Production API returns 500. HARD BLOCKER, 0.5 d.**
`api.voltai.uz` returns `500 FUNCTION_INVOCATION_FAILED` with `server: Vercel`. Two independent structural causes: (a) `node-sqlite3-wasm` loads its binary via `readFileSync(__dirname + "/node-sqlite3-wasm.wasm")`, a dynamic path `@vercel/node`'s file tracing does not follow, so the module throws at init — which is why you get `INVOCATION_FAILED` rather than the app's own 500 JSON handler; (b) `getDb()` additionally `mkdirSync`s into a read-only lambda FS with no `voltai.sqlite` deployed (`data/` is gitignored). **Vercel cannot host this API at all.** Do not debug the function. Finish the intended migration per `RUNBOOK.md` §4 (`cloudflared tunnel route dns voltai-api api.voltai.uz`) and delete `vercel.json` + `api/index.ts`, both listed for deletion in `ARCHITECTURE.md` §7 — ⏳ **still outstanding as of 2026-08-15**; both files are still tracked and still deploy the 500-ing function. This blocks the whole app, not just this feature.

**8.2 — The merge stall. 1 d, not optional.** ✅ **FIXED (2026-08-15)** — the grid-bucket rewrite below shipped: 8966 ms → 180 ms, output byte-identical, guarded by `scripts/merge-check.ts` (see the status table above). The diagnosis below is kept verbatim, in the present tense it was written in, for the reasoning.
`mergeStations()`'s dedup is an O(n²) `merged.findIndex()` over 1985 raw rows performing 1,091,767 distance + name-similarity comparisons, measured at **6.0–6.5 s of fully synchronous, event-loop-blocking CPU on a fast desktop**, re-run after every scrape (self-rescheduling at 3–5 min). On the phone that is plausibly 25–50 s. It caps p95 plan latency and it costs more battery and thermal headroom than every planner optimization combined. Fix: grid-bucket candidates by ~0.001° so only the 9 neighbouring cells are compared, and hoist `nameSimilarity`'s two regex normalizations and three Set constructions out of the inner loop.

**8.3 — Data cleanup that must precede any planning.**
In dependency order, all in v1 items 1–3:
1. **Connector canonicalization** — without it the routable graph is 630 sites instead of 1014 (it would discard spectre-energy's 453 category-less GB/T connectors and k-watt's 198 `GB/T DC` rows entirely). Single highest-leverage change in the feature.
2. **Per-gun vs cabinet power** — `connector.power` is currently a site rating replicated onto every gun (62% of multi-gun sites show the fingerprint), so a charging-time model reading 140 kW off an 80 kW gun overestimates by up to 2× — corrupting exactly the objective the feature exists to serve.
3. **Site dedupe** — cross-source merge fires on 3 of 1211 stations; 20.7% of routable rows are redundant at 250 m.
4. **`power === 0 → null`**, and the name parser wired as a **contradiction detector**, not a backfill (0/44 recovery on the rows that need it; 81 conflicts detected, 31 of which flip ≥50 kW eligibility).

**8.4 — The gap figure in the brief is wrong.**
The brief's "~100 km" is a straight-line bucketing artifact. Measured along the real driving polyline the worst hole is **132–135 km (km ~317 → ~449)** and it **ends at the destination** — there is no bail-out charger inside it. For CCS2 it is 157 km plus a second 88 km gap. **Size every margin against 135 km.** Re-run the gap measurement after any connector-filter change, because the feasible graph moves enormously between plugs. Also note the road distance: measured **453.3 km**, not the 520 km in the brief (see §9 Q1).

**8.5 — Dead Yandex routing key (401 "Apikey rejected"). No action. Do not revive.**
Even with a working key it would not help: MapKit is pinned to the `lite` flavor, so the SDK cannot route client-side, and the server already gets distance + polyline from MyTaxi with better Uzbek road data than any OSM-backed engine. Reviving it would be a paid dependency for a capability we already have. If you later want *geocoding* (address → coordinates), that is a different Yandex product and a different key — and it is out of v1 scope by design (§6.4).

**8.6 — Google Maps billing disabled (REQUEST_DENIED). Leave it disabled.**
Google Directions in Uzbekistan is not measurably better than MyTaxi for this corridor, and enabling billing puts a metered dependency on the critical path of a free app. The only reason to revisit is Places/geocoding, which v1 does not need. Recommend: keep it off, and do not let it back in through the "let's just add a search box" door.

**8.7 — MyTaxi key custody and unknown limits.**
Currently shipped as `EXPO_PUBLIC_MYTAXI_API_KEY`, i.e. extractable from any bundle; if abused or rotated, every installed client breaks at once with no hot-fix short of an app release. Move to server `.env`, remove from `apps/mobile/.env.example`, never add to `eas.json`. Rate limits are undocumented — token bucket, circuit breaker, 90-day cache, and ORS pre-wired in v2. Also verify `CF-Connecting-IP` handling before trusting per-IP throttling behind Cloudflare, or the rate limiter is either useless or a self-inflicted outage.

**8.8 — No test framework in `apps/api`.**
The only quality gate is `npm run lint` = `tsc -p tsconfig.json --noEmit` under `strict: true`. Do not introduce jest as a side effect. Write `scripts/plan-check.ts` as a plain node script and wire it into the lint script so it actually runs. A planner is exactly the kind of code where a silent 10–20% regression in trip time is invisible without assertions.

**8.9 — Build/runtime constraints that will bite.**
CommonJS via `tsc` (`module: CommonJS`, `target: ES2022`, `rootDir: "."`) — ESM-only dependencies break `npm run build`. No native-compile dependencies (the whole reason for `node-sqlite3-wasm`). Non-code assets are not copied to `dist/`, so schema and catalogs must be TS constants. `MapKit lite` is pinned in two files that must stay in sync. Mobile requires a dev-client/EAS build.

---

## 9. Open questions for the product owner

Each has a recommended default. **None of these block work** — start building against the defaults.

**Q1. Is Tashkent → Qarshi 520 km or 453 km?**
Three independent measurements against the real MyTaxi driving polyline give 453–458 km. The 520 km figure may be a different route (via Shahrisabz and the Takhtakaracha pass?), an older road, or include city driving.
*Default:* trust the routed distance, display it prominently, and stop quoting 520. If you know of a genuinely different 520 km road that people actually drive, tell me — it would need its own corridor entry, and the pass would trigger the elevation exception.

**Q2. How long does a real Uzbek DC charging session take to *start*?**
`T_PLUG = 5 min` covers park + plug + app + authorise + unplug. This constant materially changes the answer: at 0 min the optimum is 2 stops to 40% SoC; at 5 min it is 1 stop to 70%. Tashkent→Qarshi is exactly that sensitive regime.
*Default:* 5 min, env-tunable, and instrument it in v2. If operator apps in practice take 3–4 minutes of QR-scanning and payment fiddling on their own, tell me and I will raise it to 7.

**Q3. What are the ten most common EVs in Uzbekistan?**
The vehicle catalog (consumption, DC cap, curve preset) is the second-largest error source after the user's range number, and `maxDcKw` is not derivable from range.
*Default:* ship the seven entries in §4.1 with an `UNKNOWN` fallback of 90 kW / 0.18 kWh/km / k=2.0. Give me a real list and I will seed it properly — this is a 30-minute change with an outsized accuracy payoff.

**Q4. Do we support non-GB/T cars in v1 as an explicit refusal, or hide them entirely?**
A CCS2 owner gets a wall either way; the question is whether it is an informative wall.
*Default:* **support the car record with an educational refusal** naming the real gap ("only 114 CCS2 chargers nationwide; the Samarkand→Qarshi stretch has a 158 km gap"). It is honest, it is better product, and it tells the owner something true about the country's network.

**Q5. Should the planner ever offer a 30 kW rescue plan when 50 and 40 kW both fail?**
A 30 kW top-up adds roughly 50 minutes but can make an otherwise impossible trip possible.
*Default:* **offer it as an explicit, one-tap opt-in after showing the blocking gap — never automatically.** The user asked for "only high-power DC chargers"; silently inserting a 30 kW stop violates that, but refusing to even mention it when it is the difference between going and not going is unhelpful.

**Q6. May we collect anonymous charge-session telemetry (arrival SoC, departure SoC, elapsed minutes, site id, gun kW)?**
The charging curve presets carry ±19% RMS error and −38% on peaky NMC; `T_PLUG` and `WAIT_BUSY` are guesses. Without real sessions these constants never improve.
*Default:* **yes, opt-out, no PII, stored in `plan_log` + a `charge_log` table on the phone origin.** This is the single cheapest path to a materially better planner and it is what v2's calibration work depends on.

**Q7. Is the MyTaxi proxy key ours to use, and are there terms?**
It is a third-party taxi endpoint. The design already caps usage at ~0.05 calls per plan in steady state and moves the key server-side to a single controllable IP.
*Default:* **proceed server-side with the token bucket and breaker**, and pre-wire ORS in v2. If there is any doubt about the key's provenance, that changes the v2 priority order — say so and I will move the ORS fallback into v1.

---

## 10. What I would NOT build

**Algorithms — because C ≤ 50, not 20 million.**
- Contraction Hierarchies, bicriteria CH, CHArge preprocessing. Built for continental road graphs we do not own.
- Charging Function Propagation function-labels: SoC-profile triples `(minBat, cost, maxBat)`, function linking, functional dominance `f_ℓ(τ) ≥ f_ℓ'(τ) ∀τ`, explicit switching-sequence computation. Replaced exactly by breakpoint enumeration + 2-D Pareto, at roughly 1/20th the code, for the same answer. **Review rule: a PR that introduces a piecewise-function type for labels is rejected on sight.**
- ω-dominance, ε-dominance with proven bounds, FPTAS constructions, sampling heuristics.
- A* potentials from a backward Dijkstra over a road network. The corridor is essentially 1-D; the §2.7 D4 bound is already tight.
- Uniform SoC discretization / the bipartite sub-node gadget. Larger *and* approximate.
- Column generation, branch-price-and-cut, metaheuristics. Fleet-VRP tools.
- MDP occupancy reoptimisation. A flat `+12 min` wait penalty is the correct amount of modelling for data where one operator replicates station status onto every gun and another fabricates it positionally.

**Physics — because it is 6× smaller than the derate and 20× smaller than the input error.**
- Per-segment v² integration. M39 is signed 100 km/h; the realistic 100–115 km/h cruise band is a ~14% spread that folds into a constant.
- Elevation in v1. Measured contribution on the whole Tashkent→Qarshi corridor: **+3.2% of leg energy**, with only 3.5% disagreement between a cheap net-elevation model and an expensive rolling-terrain model. Deferred to v3 behind a `max_elev − max(endpoints) > 400 m` gate that fires on one road in the country.
- Wind, payload, HVAC modelling, battery preconditioning, speed–consumption co-optimisation, battery swapping, multi-visit to the same station.

**Infrastructure — because the backend is a phone.**
- Self-hosted OSRM / Valhalla / GraphHopper. OSRM needs ~4–7 GB RAM to build, Valhalla OOMs at 4 GB, all three are native C++/JVM ARM builds against this project's deliberate choice of WASM SQLite — and they would deliver **worse** road data, since OSM covers only ~24% of Uzbekistan's road length with documented gaps in Samarkand, Guliston and Qarshi specifically.
- GraphHopper Cloud as a fallback: its free tier is explicitly non-commercial and capped at 5 locations. Do not let it into the provider rotation by accident.
- A `POST /api/plan`. Zero edge caching, zero 304s, on the one origin that cannot afford either.
- Server-side accounts, auth, user tables, cross-device sync. The response must depend only on the query string; that is what makes edge caching possible, and there is no PII to lose on a phone in a drawer.

**Data — because there is nothing there.**
- A `working_hours` parser. 100% NULL in both `stations` and `raw_stations` across all four sources; `description` also 100% NULL; two names embed a time range. Assume 24/7 and caveat it.
- Per-gun occupancy modelling. Tokbor replicates, Beon fabricates. Site-alive plus a wait penalty is the honest ceiling.
- Guessing power for the 44 zero-power sites. Name parsing recovers 0 of them and Beon's upstream simply omits `maxCapacity` for 39 of 89 sites. Routing someone to a 7 kW AC post 100 km into the desert is worse than excluding a site.
- Connector-count-based queue modelling. The merge collapses connectors by `type-power`, so `count` is not a physical plug count.

**Mobile — because none of it exists and all of it is app-wide.**
- A state-management library (zustand/redux/jotai). Nothing is installed; `apps/mobile/store/` is Play Store listing assets; `TECHNICAL_ARCHITECTURE.md`'s zustand section is stale aspiration.
- MMKV, expo-sqlite, or any new persistence dependency. AsyncStorage + `lib/storage/jsonStorage.ts` is the installed pattern.
- An i18n framework. Zero i18n deps, zero Cyrillic in any source file — introducing one is a separate refactor.
- A polyline-decoder package. 25 lines of JS.
- Switching MapKit to the `full` flavor. `<Polyline>` already works on `lite`; `full` buys only routing and geocoding, both of which we get over HTTP or do not need.
- New tabs. The floating pill is icon-only with a closed `IconSymbol` MAPPING union; use root Stack routes.
- Free-text address geocoding. No viable provider (MapKit lite can't, Yandex key dead, Google billing off), and intercity EV trips are city-to-city.
- Overlaying the route on the tab map. That map's `markers` useMemo depending only on `stationGroups` is a load-bearing perf invariant from commit `818e365`; the results screen gets its own map instance.

**Two things I would not build that all three candidate designs proposed:**
- **`D_style` in the relax ladder.** Making an infeasible trip feasible by assuming the driver drives 10% more gently conjures ~28 km of margin on `Rp = 328`, applied globally, at exactly the moment the margin is load-bearing, behind a banner nobody reads. It is a stranding mechanism dressed as a relaxation.
- **A second copy of the solver in `apps/mobile` synced by file copy and a SHA-256 check.** The drift failure mode — "the server plan and the offline plan disagree about the desert leg" — destroys trust in both. Offline planning is worth building; it is worth building *once*, behind a real shared package, which is v2 item 3.