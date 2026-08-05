# PM Plan — value-summary-tick

**Intake:** `intake/2026-08-04-value-summary-tick/`
**Date:** 2026-08-04 · **Mode:** auto-pilot (`/team-intake auto`)
**Inputs read in full:** `request-brief.md`; `supporting/product-owner.md`,
`architect.md`, `engineer.md`, `qa.md`; `PROJECT-CONTEXT.md` §9.1–§9.7 + the four
candidate patterns; `intake/2026-08-02-plan-lifecycle-value-ledger/decisions.md`
(DEC-P1..P6, DEC-12, DEC-16, DEC-20, DEC-21); PM memory
(`~/.claude/skills/team-intake/memory/request-log.md` rows 29–50,
`decision-log.md`); and the live tree (`server/lib/value-summary.js`,
`value-ledger.js`, `server/index.js`, `client/src/lib/types.ts`, git status/log).

---

## 1. Request summary

The Value Pool's PROJECT/STAKEHOLDER altitude synthesis caps at 40 uncached units
per request. On Sara's real projects — the Coaching Assistant pool measured **182
units** on 2026-08-03 — that means a single page visit answers about a fifth of
the question, full coverage needs roughly three manual reloads, and a unit with no
text is indistinguishable from a unit whose synthesis failed. Sara caught this
herself in design review on 2026-08-04, hours after the altitude layer was
written, and set a three-word acceptance bar: **scalable, observable, the right
long-term fix.** She sketched a direction — move generation to a background tick,
make the interactive endpoint read-only, push updates over the WebSocket, add
Settings-level cache observability mirroring Focus Summaries — and explicitly did
not approve or scope it.

---

## 2. Request type — final call

### `missed-requirement`, with one `new-feature` carve-out

**Overturns triage's provisional `new-feature`.** The evidence is decisive and it
is inside our own record:

- On **2026-08-03**, DEC-12 of the parent effort was signed off by Sara against a
  rendered **live 182-unit pool** (90-day lookback) — the checkpoint that
  unblocked slice 5. The real scale of a real pool was measured, written down in
  `decisions.md`, and approved.
- On **2026-08-04**, the altitude layer was written with `MAX_UNITS_PER_PROMPT = 40`
  and this comment (`server/lib/value-summary.js:36-38`):

  > `Matches focus-summary's session-cap rationale: bounded prompt size, most`
  > `recent items win when a batch runs over. Pool batches are small in`
  > `practice, so overflow is expected to be rare.`

  "Overflow is expected to be rare" was **false at the moment it was typed**, and
  the number proving it false was one day old, in the same effort's own decision
  log, signed by the same person.

So this is not "a subsequent data point invalidated a documented design choice"
(the product-owner's framing, §2) — the data point *preceded* the choice. We built
exactly what the requirement said; the requirement was incomplete, and the check
that would have caught it (size the bound against the measured population) is a
step no role owns. That is textbook `missed-requirement`.

It is **not a bug** — nothing is broken; the 40-cap does precisely what it was
coded to do. It is **not a regression** — nothing worked and then stopped. It is
**not `new-feature`** merely because the remedy is large: the size of a fix does
not reclassify the defect that motivates it. The parent feature's own headline
promise (DEC-P4: the dashboard's altitude is *delivered value*; the pool's stated
question is "what value did this project deliver across its life") is not met by an
answer that silently omits 142 of 182 units.

**Cost framing:** items (a) hybrid endpoint, (b) background tick, (c) WebSocket
push, and the per-unit "queued vs. unavailable" signal are **our cost** — closing a
requirement we should have met. **Carve-out:** the operator-level Settings
observability surface (new routes + a parallel `CacheSection`-scale UI section) is
genuinely **`new-feature`** / a **new ask** — the parent feature never promised an
operator audit surface for value summaries, and Focus Summaries' own Settings
section was its own build. This split is not cosmetic: it is exactly the boundary
DEC-4 below draws for what ships in v1.

---

## 3. History / background — where this is coming from

### Timeline

| When | What | Relevance |
|---|---|---|
| 2026-07-26 | `focus-report-fidelity` — first team-intake item for this repo, classified **missed-requirement**; seeds §9.1 DERIVED-DUAL-VIEW | Same shape: built what was asked, the ask didn't name every consumer |
| 2026-07-31 | `focus-untracked-commits` — classified **missed-requirement** *for process*: "work should have gone through team-intake before merge" | See "third thread" below — live again today |
| 2026-08-01 | `build-project-manager` — `server/lib/reconciliation.js` in-process scheduler built, background-first | Tick precedent #11; the two-dimensional per-tick cap shape (`MAX_TARGETS_PER_TICK` 10, `MAX_DETOURS_PER_TICK` 10, `DASHBOARD_RECONCILE_MS` 4h) |
| 2026-08-02 | `plan-lifecycle-value-ledger` — the parent. `new-feature`. DEC-P4 sets the altitude ceiling; DEC-16 makes `value-ledger.js` the sole pool composer with a test-enforced `CONSUMERS` allowlist | This request is a **direct extension** of that effort |
| 2026-08-03 | DEC-12 answered **SIGNAL** on the live **182-unit** Coaching Assistant pool; slice 5 unblocked. `f1799e9` (slices 1–3) and `ff42f4f` (slice 5 UI) land | **The measurement that the 40-cap contradicts** |
| 2026-08-04 | Altitude layer written — `server/lib/value-summary.js` + `value-summary.test.js`, 991 insertions across 27 files. Sara catches the scale gap the same day | This intake |

### Have we seen this before? Four separate answers, and they differ

**a) The capability — "add a background tick" — seen 11 times, never like this.**
`startBackgroundServices()` (`server/index.js:343`) already registers eleven
services: update scheduler, cc-watcher, workflow poll, plan poll, focus audit,
focus inference, reconciliation, playbook engine, account capture, session sync,
remote-source sync. This would be the twelfth, and the pattern is thoroughly
established (boot delay + `unref`'d `setInterval` + `running` overlap flag +
env-gated cadence/mode + per-service `try/catch` isolation). **But all eleven were
background-first from day one. This is the first retrofit of a tick onto an
already-shipped synchronous request path** — and that difference is the whole
engineering risk: the other eleven never had a pre-existing writer to coexist
with. There is no named catalog entry for this shape, and I am **not** creating one
(one instance is not a pattern, per this project's own convention) — but the build
must not treat "mirror `focus-inference.js`" as sufficient, because
`focus-inference.js` never had to answer the two-writer question.

**b) The two-writer / single-writer-guard shape — seen at least 6 times, and for
the first time the cures already exist.** §9.1 stands at 6 counted touches, §9.7 at
6. What is different today: `server/__tests__/helpers/single-home.js`'s
`assertSingleHome` is **merged and on master** (arrived with `ef42b65`),
`single-writer-guard.test.js` exists, and `chronology-ordering.test.js`'s
`FILE_DISPOSITIONS` is genuinely derived from `server/lib/*.js` +
`server/routes/*.js` (all 88 files) since 2026-08-03. **This is the first build
that can consume rung-4 cures instead of re-deriving them** — and the specific
failure mode to avoid is named in the catalog already: "a second hand-rolled
scope-derivation helper would be §9.1's 'scan for copies of its helpers too'
recurring at the guard level."

**c) The actual defect shape — new, and worth naming.** See §4.

**d) The process recurrence — seen, unfixed, and live *right now*.** As of this
writing, `git status` shows the entire altitude feature **uncommitted on `master`**:
991 insertions across 27 files, with `server/lib/value-summary.js` and
`server/__tests__/value-summary.test.js` **untracked**. The 2026-08-02 PM plan
recorded this repo's other chronic recurrence verbatim: *"new capability ships
direct-to-trunk with nothing recording it — 3x here + 2x cross-project, same
durable process fix recommended 3x and adopted 0x because it needs a human to
remember it at commit time."* `focus-untracked-commits` (2026-07-31) was
classified `missed-requirement` for exactly this. **It has happened again, on the
very feature this request is about, within 24 hours.** This is not a side note — it
mechanically threatens this build (see OPEN-1 in §7).

### Decisions this request touches — cited, not re-litigated

- **DEC-P4** (altitude ceiling: delivered value + desired value + reconciliation,
  nothing repo-local) — **unaffected**. Synthesis text is already inside that
  boundary; nothing here stores repo-local content.
- **DEC-16** (one composer, `assembleValuePool`; `CONSUMERS` is the allowlist) —
  **honoured, and it will fire.** `value-ledger.js:57` declares
  `CONSUMERS = ["server/routes/project-plans.js", "bin/ccam.js (cmdLedger)"]`, and
  `ledger-metrics-parity.test.js` C2.4 does an exact sorted `deepEqual` against it.
  The tick must call `assembleValuePool` to know what to sweep, so **C2.4 goes red
  the moment the tick is written.** That is the tripwire working, not a violation
  — but it must be resolved in the same change (DEC-7 below), never discovered
  after.
- **No contradiction with any settled decision found.** Nothing here reopens
  DEC-P2, DEC-P6, or any parent WATCH row. DEC-16's standing obligation (new
  consumers read through the shared module, never recompute) is carried into
  acceptance criteria verbatim.

---

## 4. Recurrence diagnosis — the systemic cause

Three threads, only one of which is about this feature.

### Thread 1 — the constant was copied; the honesty was not

`value-summary.js`'s header states it "Mirrors `focus-summary.js`'s
synthesis-layer pattern deliberately," and the 40-cap comment says it "Matches
focus-summary's session-cap rationale." Both true. But `focus-summary.js` solves
the same over-cap problem in two ways this copy dropped:

1. It **decomposes** (hierarchical per-day summarization above
   `DIRECT_WINDOW_MAX_DAYS`, so no session cap ever drops a whole day), and
2. when it does drop, it **says so** — "earlier ones dropped with an explicit
   note."

`value-summary.js` copied the cap and neither of those. Its own JSDoc makes the
consequence explicit: *"A unit absent from the result means no altitude could be
produced this round (LLM off/unavailable, spawn failure, or unparsable output)."*
Plus over-cap. Plus not-yet-attempted. **Five distinguishable states, one wire
representation: absence.** That is the request's entire problem statement, and it
was authored, not accumulated.

This is §9.1's family but **not §9.1 itself**, and applying §9.1 by rote here would
be wrong for the same reason the trunk-drift pre-flag was retracted: there is no
single value multiple sites should agree on. It is a *contract* defect, not a
duplicated-computation defect. I am recording it as a **candidate pattern with a
promotion trigger** (this project's established convention — see
SHARED-BUDGET-STARVATION, CWD-IDENTITY-FANOUT, CONTRACT-SPEC-DRIFT,
TEST-AGAINST-LIVE-DB), not as a new §9.x entry:

> **Candidate — OVERLOADED-ABSENCE.** A "never throws, never blocks" contract
> encodes *not-yet*, *over-budget*, and *permanently-failed* as the same empty/absent
> value, so no consumer can distinguish transient from terminal, and no operator can
> tell a backlog from an outage. Two live instances found: (1)
> `value-summary.js`'s `enrichPoolAltitudes` (this request); (2)
> `reconciliation.js`'s `parseDispositionOutput`, which ends in
> `catch { return new Map(); }` — an empty map meaning both "nothing to disposition"
> and "the whole tick's verdicts were silently voided" (already documented from a
> different angle under SHARED-BUDGET-STARVATION). **Cure:** a per-item discriminated
> state on the wire, not a heuristic on the client. **Promote** the first time a third
> surface is found, or the first time one of these two is shown to have misled a real
> diagnosis.

**The durable fix is the discriminated state, not a bigger number.** Raising the
cap to 200 would close the 182-unit case and re-open at 201, with the same
ambiguity. This is why "the right long-term fix" is a claim about shape.

### Thread 2 — an inherited assumption nobody owns re-validating

The generalizable failure: **a copied constant carries the source's population
assumptions into a context where they were never re-measured.** The catalog's
2026-08-02 lesson said the near-identical thing one way ("duplication of a constant
is free until someone makes the constant configurable"); this says it the other way
— *until someone changes the population it was sized for*. Both times, the copy was
made by whoever already had the source in their head. The cheap countermeasure,
recommended below as an acceptance criterion rather than a hope: **any bound on a
user-visible collection must cite the measured real distribution it was sized
against, in the same comment that declares it.** Here that comment would have had
to say "182" and would have failed to write itself.

### Thread 3 — the intake trail, still open after three recommendations

Recommended 3x, adopted 0x, because it depends on a human remembering at commit
time. It fired again this week. I am not re-recommending the same process fix; I am
converting it into a **build precondition** with a mechanical consequence (OPEN-1),
because that is the only version of it that has ever held on this project.

---

## 5. Where this is coming from — root source

**Root source: an incomplete requirement, inherited by copy, never checked against
data we already had.**

Not drift (the code matches its own docs). Not a misunderstanding (the design was
understood and deliberate). Not a missing test — and this is worth stating clearly,
because it is the tempting wrong answer: `value-summary.test.js` has 13 green tests
and `PlanLedgerPanel.test.tsx` has 11, all correct about what they assert. QA's §2
finding is sharper than "we lacked coverage": the client test
`"shows a generating placeholder … before altitudes resolve"` passes today on a
deliberately-stalled mock Promise, and would keep passing under a design where
"Generating…" is no longer a truthful description of anything — a §9.3 vacuous shape
arriving by *premise decay* rather than by a weak assertion. More tests of the same
kind would not have caught this.

What would have caught it: sizing `MAX_UNITS_PER_PROMPT` against the 182-unit pool
that the same effort's DEC-12 had rendered and approved the previous day.

---

## 6. Recommendation to the human

**Approve the work as a hardening pass on the just-shipped Value Pool, ahead of any
net-new portfolio surface** (DEC-16's three deferred consumers, WATCH-3's
cross-project rollup). The product-owner's sequencing argument is right and I adopt
it: those consumers would each inherit the 40-unit ceiling and the same ambiguity,
so building on top of the known-broken-at-scale version compounds the eventual fix.
Nothing is on fire; the gap is already live on Sara's primary use case.

Effort: **M** for the approved v1 cut (the engineer's L was driven by Layer E, which
DEC-4 moves out).

### The three open questions — resolved, not relayed

#### DEC-2 — Sweep scope: **every tracked project is eligible; each tick sweeps a bounded, least-recently-swept slice**

This is a **synthesis that partially overrides the product-owner**, on evidence the
product-owner did not have. Reconciling the three specialists:

- The **product-owner** recommends sweeping every `project_paths`-tracked project,
  arguing the cost is bounded because `value_unit_summaries` never expires, so "a
  tick sweeping a project with zero new units costs a DB-and-git read, not an LLM
  spawn."
- The **engineer refutes the cost premise, and I verified it directly.**
  `assembleValuePool` calls `isGitRepo`, `cwdIdentity.repoRootFor` (a `git rev-parse`)
  and `detectTrunkDrift` (a `git log` walk) **on every call, per repo root,
  regardless of cache state** (`value-ledger.js:148`, `:152`, `:231`). The LLM cache
  saves spawns; it saves no git work. "Sweep everything every tick" is therefore
  O(projects) `git log` walks per interval, forever.
- The **architect** recommends recency-bounding (`ORDER BY updated_at DESC LIMIT N`,
  mirroring `listReconcileTargets`).

The product-owner's *goal* is right and the architect's *mechanism* defeats it:
recency-scoping reintroduces exactly the staleness-depends-on-Sara's-click-history
problem this request exists to remove — "a project she hasn't opened in months is
precisely the one she'd want already caught up."

**Decision:** keep the product-owner's scope, take the architect's bound, and change
the *ordering key*. Every project with a `project_paths` mapping is eligible. Each
tick processes at most `MAX_PROJECTS_PER_TICK`, selected **least-recently-swept
first** (`ORDER BY last_swept_at ASC`, NULLs first) — a starvation-free round-robin,
not a recency filter. Fleet coverage is then complete and its worst-case latency is a
number you can state: `ceil(projects / MAX_PROJECTS_PER_TICK) × cadence`.

Requires one new piece of state: `value_summary_sweep_state(project_id TEXT PRIMARY
KEY, last_swept_at TEXT, pending_after_sweep INTEGER)`. It lands with the **tick
(Layer A), not with Layer E**, so the deferral in DEC-4 cannot strand it. New
`CREATE TABLE IF NOT EXISTS`, additive, no ALTER, no rebuild — §9.5/§9.6 are
**inapplicable rather than complied-with**, which is the stronger outcome the
catalog's own 2026-08-02 lesson asks for.

Optimization for the implementer, not a requirement: `startRemoteSourceSync`
(`server/index.js:523`) is the local precedent for a cheap gate before real work —
check empirically whether a project whose plans/commits are unchanged since
`last_swept_at` can skip the git walk entirely. Bound first, then optimize.

#### DEC-3 — **Hybrid (architect's Option B). Not pure read-only.**

The product-owner and the architect converged on this **independently**, from
different premises (product-owner: solving the tail by breaking the median;
architect: CLAUDE.md's own "preserve existing behavior unless explicitly asked to
change it"), and the engineer's Layer B analysis confirms pure read-only is
mechanically trivial (~10 lines) but behaviorally a regression for the common case.
Three independent evaluators, one answer. `POST /api/project-plans/altitudes` stays
exactly as it is today; the tick's job is specifically the overflow the request path
structurally cannot reach.

Sara sketched read-only; she did not rule it. Nothing is being overridden — an
unapproved sketch is being improved on, which is what this phase is for.

**The price, paid explicitly:** two writers of `value_unit_summaries` by design. The
architect and engineer both specify the cure and I make it a gate (DEC-6). The
invariant that makes the hybrid structurally safe is stronger and cheaper than
"who may call `enrichPoolAltitudes`": **`upsertValueUnitSummary.run(` must have
exactly one lexical call site in the whole repo** — today it has exactly one,
`value-summary.js:179`, inside `enrichPoolAltitudes`. Both writers then reach the
table through one composer, and there is no divergent-logic risk at all, only
divergent invocation — which that guard catches.

#### DEC-4 — Observability: split, **with the boundary moved**

The product-owner recommends shipping (a)-(c) now and sequencing (d) the whole
observability layer as a fast-follow. I adopt the split and **move the line**:

**v1 (our cost, ships together):**
- hybrid endpoint (unchanged) + background tick + WS `value_altitudes_updated`;
- the **per-unit discriminated state** — at minimum `queued` (known, awaiting a
  tick) vs. `unavailable` (attempted this round, LLM off/failed/unparsable). This is
  the literal fix for the request's own problem statement and is AC-2's minimum bar;
- **the audit-log table and its write call sites.**

**Fast-follow (the `new-feature` carve-out, named and dated, not dropped):**
- `GET` Settings routes and the Settings → Value Summaries UI section.

**Why the table moves into v1, against the product-owner's grouping:** it is a
`CREATE TABLE IF NOT EXISTS` plus two prepared statements, its write sites live
*inside* the new tick file, and deferring them means re-opening reviewed tick code
later to thread logging through it. More decisively — QA §5 step 4 names the
manual proof of "observable" as *"check the new observability section and confirm
tick-start/tick-end and hit/miss counts are visible."* Without the log there is
nothing to check, and **no way to answer empirically whether the tick actually
keeps up on the 182-unit project** — which is precisely the number DEC-2's
coverage-latency formula must be validated against. The instrument ships with the
thing it measures. That is the same "get real data before building the expensive
UI" discipline as DEC-12, applied one layer down.

#### DEC-5 — The two numbers the brief left unset

Nobody defaults these silently:

| Setting | Default | Rationale |
|---|---|---|
| `DASHBOARD_VALUE_SUMMARY_TICK_MS` | `600000` (10 min); `<=0` disables | Matches `DASHBOARD_FOCUS_INFER_MS` — the closest-shaped precedent (an LLM synthesis drain), not `DASHBOARD_RECONCILE_MS`'s 4h monitoring cadence |
| `BOOT_DELAY_MS` | `30_000` | Same as `focus-inference.js` — first sweep soon after start is the backfill |
| `MAX_PROJECTS_PER_TICK` | `3` | Mirrors `reconciliation.js`'s two-dimensional cap shape; lower than its `10` because each project here costs a git walk **plus** up to one LLM spawn |
| `enrichPoolAltitudes` calls per project per sweep | `1` | Keeps per-tick spawn count hard-bounded at `MAX_PROJECTS_PER_TICK` |
| `MAX_UNITS_PER_PROMPT` | **unchanged at 40** | The cap is not the defect; silent overflow is |
| `DASHBOARD_VALUE_SUMMARY_TICK_MODE=off` | — | Reuse the existing disable convention; do not invent a new one |

**Required of the technical plan:** publish the derived worst-case coverage-latency
formula and validate it against Sara's real fleet size at build time. If measured
worst-case exceeds ~2h, the remedy is raising `MAX_PROJECTS_PER_TICK` or lowering
the cadence — both env vars, no code change. The v1 audit log is what makes that
measurable.

### The engineer's live pre-existing bug — separated from this request's scope

**Confirmed by direct read, independent of anything this request proposes.**
`server/routes/project-plans.js` broadcasts `project_plan_updated` at lines
173/197/222/244/252/262 and `value_claim_updated` at 360/379 — **eight call sites,
two message types, neither present in `client/src/lib/types.ts`'s `WSMessage.type`
union** (which carries only the unrelated legacy `plan_updated`). The union's own
doc comment declares it hand-maintained and append-only; TypeScript cannot catch the
omission because `eventBus.publish`/`subscribe` are generic over `WSMessage`.

**This is not caused by this request and must not be absorbed into its cost.**
Disposition, in two parts:

- **The defect itself: fix inside this build (DEC-8), same commit.** The file is
  being opened anyway for `value_altitudes_updated`; adding a third entry to a
  registry with two known-missing entries is exactly how a hand-maintained registry
  rots. It is small and mechanical. **Constraint the build must not over-apply:**
  add the two **type entries only**. Do **not** add subscribers for them.
  `PlanLedgerPanel.tsx` has never listened to any WebSocket message (zero `eventBus`
  imports today, confirmed by two evaluators); wiring it to react to
  `project_plan_updated`/`value_claim_updated` would make it respond to other
  clients' concurrent edits — behavior it has never had, and a scope change nobody
  asked for. Type-level only is a zero-runtime-behavior change.
- **The class-level cure: its own separate item (WATCH-1).** A server-broadcast-type
  ↔ client-union parity check. §9.7 already documents `types.ts` as a knowingly
  hand-typed cross-runtime surface carrying a doc comment *instead of* a scan
  (`TrunkDriftResult["skipped"]`); this is the second member of that surface to
  drift, which is the argument for the scan — but building it is not this
  request's cost.

### Acceptance criteria — Sara's own three words, made checkable

- **AC-1 (scalable).** Opening Project Detail for a project with an arbitrarily
  large pool requires **zero page reloads** to eventually reach full altitude
  coverage, and the interactive endpoint's per-visit work does not grow with total
  pool size (bounded by the existing ≤40 fast path). **Verified against the real
  Coaching Assistant pool (182 units), not a synthetic fixture.**
- **AC-2 (observable).** Every unit without synthesized text renders as one of two
  visibly distinct states — *queued* vs. *unavailable, will retry* — never a single
  ambiguous placeholder. Plus: the v1 audit log shows real per-tick hit/miss/backlog
  counts against that same project.
- **AC-3 (the right long-term fix).** (a) `assembleValuePool` remains the sole pool
  composer — the tick reuses it, joins `CONSUMERS` explicitly (DEC-7); (b)
  `upsertValueUnitSummary.run(` has exactly one lexical call site, enforced by a
  red-proven structural guard whose scope is **derived, not hand-typed** (DEC-6);
  (c) the read/write split is a recorded decision, not a byproduct of what was
  easiest to build.

### The cycle-breaker: what must exist before build starts

The architect's closing risk is the one that matters most and I am converting it
into a gate. Quoting it: *"none of them has a `decisions.md` PENDING/WATCH row yet
… these become exactly the kind of disclosed-but-untracked exclusion this project's
own process exists to prevent — functionally identical to nobody having found them."*
This intake folder currently contains only `request-brief.md` and `supporting/`.

**`intake/2026-08-04-value-summary-tick/decisions.md` must exist, with these exact
rows, before the first line of build code is written:**

| Id | Subject | Status |
|---|---|---|
| **DEC-1** | Classification: `missed-requirement` + `new-feature` carve-out (Settings routes/UI) | DECIDED-AUTO (PM) |
| **DEC-2** | Sweep scope: all tracked projects eligible, bounded least-recently-swept rotation, new `value_summary_sweep_state` table lands with Layer A | DECIDED-AUTO (PM) — **overrides the product-owner's sweep-all on the engineer's verified git-cost evidence** |
| **DEC-3** | Hybrid (Option B); `POST /altitudes` unchanged; tick covers overflow only | DECIDED-AUTO (PM) — product-owner + architect converged independently |
| **DEC-4** | Observability split: v1 = state signal + tick + WS + **audit table & writes**; fast-follow = Settings routes + UI | DECIDED-AUTO (PM) — boundary moved from the product-owner's proposal |
| **DEC-5** | Cadence/cap defaults per the table above; technical plan publishes the coverage-latency formula and validates it at build | DECIDED-AUTO (PM) |
| **DEC-6** | Single-writer guard: **consume `assertSingleHome`** (`server/__tests__/helpers/single-home.js`, on master since `ef42b65`) — do not hand-roll a second scope-derivation helper. Scope derived from `upsertValueUnitSummary`'s real call sites. Red-proven by injecting a rogue second `.run(` site, per §9.3's standing rule | DECIDED-AUTO (PM) |
| **DEC-7** | Tick joins `value-ledger.js`'s `CONSUMERS` **and** `ledger-metrics-parity.test.js` C2.4's expected array in the **same** change — C2.4 goes red by design the moment the tick is written | DECIDED-AUTO (PM) |
| **DEC-8** | `WSMessage` union: add `value_altitudes_updated` **plus** the two pre-existing missing types, **type-level only, no subscribers** | DECIDED-AUTO (PM) |
| **DEC-9** | New `server/lib/value-summary-tick.js` gets an explicit `FILE_DISPOSITIONS` entry in `chronology-ordering.test.js` — and per QA §6, **confirm the derivation surfaces it automatically first**; if it doesn't appear un-dispositioned, the derivation has regressed and that outranks this feature | DECIDED-AUTO (PM) |
| **WATCH-1** | Durable cure for the hand-maintained `WSMessage` union (broadcast-type ↔ client-union parity scan) — deferred, own item, not this request's cost | WATCH |
| **WATCH-2** | Settings "clear data" route (`server/routes/settings.js:172-189`) omits `value_unit_summaries` **and** `value_claims` — pre-existing. Must be closed **with** the fast-follow, and the fast-follow must not add only the new log table while leaving these two absent (the omissions look identical in a diff; only one would be "new") | WATCH |
| **WATCH-3** | Candidate pattern **OVERLOADED-ABSENCE**, with the promotion trigger in §4 | WATCH |
| **OPEN-1** | See §7 | PENDING (Sara) |
| **OPEN-2** | See §7 | PENDING (Sara) |

This closes QA's DoD line *"PM has explicitly decided (not defaulted) all three
brief open questions"* — DEC-2/3/4 are that decision, with the specialist reasoning
recorded so each is auditable rather than asserted.

**Two build-shape notes that follow from the decisions above and must reach the
technical plan:**

1. The tick must expose a directly-callable `runValueSummaryTickOnce(dbModule, { broadcast })`
   separate from the `setInterval` wrapper. QA §3a found that **neither**
   `focus-inference.js` nor `reconciliation.js` has any test of its actual
   scheduling closure — overlap guard, interval firing, per-tick bound are
   untested across this entire repo. Since DEC-2/DEC-5 make those the load-bearing
   behaviors, this build has to write that infrastructure rather than copy it.
2. Splitting "Generating…" into *queued* vs. *unavailable* is an i18n change across
   4 locales (`en/ko/vi/zh`), and per §9.7 occurrence 6 the key check must be
   **derived** from the `en` namespace, never hand-typed. The three existing
   `PlanLedgerPanel.test.tsx` altitude tests survive under the hybrid (unlike under
   pure read-only), but a new >40-unit overflow case is required, asserting both
   placeholder states render distinguishably **in the same render**.

---

## 7. Open decisions for the user

Under auto-pilot I decided DEC-1..DEC-9 myself; each is logged with its reasoning
and Sara may override any of them. Two items genuinely need her, and the first is a
hard precondition.

**OPEN-1 — Commit or branch the 991-line uncommitted altitude change before this
build starts. (Blocking; recommend: do it now.)**
The feature this request extends is sitting uncommitted on `master` — 27 modified
files plus two untracked (`server/lib/value-summary.js`,
`server/__tests__/value-summary.test.js`). Three concrete consequences, beyond the
process point in §4 Thread 3:
- The new build's diff would be entangled with 991 unrelated lines, making the
  adversarial fix-round review §9.4 requires effectively impossible.
- §9.3's own standing corollary — *"any guard that shells out to `git diff` must be
  ref-anchored, because the un-anchored form silently self-disarms at commit time"*
  — has no valid base ref to anchor to while the parent change is uncommitted.
- Per the `concurrent-session-risk` note in memory (multiple Claude sessions share
  this repo's cwd; this has caused real work loss), 991 uncommitted lines on
  `master` is a live exposure independent of anything here.
Recommended: commit the altitude layer on its own branch with its own intake
reference, then branch this build from it.

**OPEN-2 — Confirm the validation project. (Non-blocking; recommend: Coaching
Assistant.)** AC-1 requires proving zero-reload coverage against real scale. The
brief notes "~100+ units" and "~3 reloads" are estimates. The parent effort's DEC-12
already rendered a **182-unit** pool on the Coaching Assistant — that is the natural
target and makes AC-1 checkable against a known number rather than a synthetic
fixture. Confirm, or name a different project.

**Explicitly not asked of Sara:** the three brief open questions. They are decided
above (DEC-2/3/4) with the reasoning recorded. She may reverse any of them; she does
not need to adjudicate them for work to start.

---

## Memory updated

- Appended a row to `~/.claude/skills/team-intake/memory/request-log.md`
  (`PROJECT-CONTEXT.md` names no project-local request log, so the global fallback
  applies).
- Added the **OVERLOADED-ABSENCE** candidate pattern, with its promotion trigger and
  both live instances, to `PROJECT-CONTEXT.md`'s candidate-pattern section — as a
  candidate, not a §9.x entry, per this project's own two-independent-rediscoveries
  bar. No existing catalog entry's occurrence count was incremented: §9.1 and §9.7
  are **pre-flagged for the build/QA phase** here, and neither has recurred as a
  shipped defect in this request.
