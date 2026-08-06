# Run Plan — `team-build` (fast + direct), `2026-08-05-altitude-invalidation`

**Director:** director-of-engineering
**Date:** 2026-08-05
**Mode:** outer invocation `fast`, agent selection `direct`
**Verdict:** **full roster runs — nothing skipped.**

---

## 1. Scope read

This is Slice 1 of the Value Pool altitude-cache mutability fix, and it is not a
small change by any measure this project uses. It ships DDL against the shared
user-global `~/.claude/agent-dashboard/dashboard.db` (six new nullable columns
across two tables, via a **new shared `addColumnsIfMissing` migration helper**
that becomes a permanent repo primitive), a new gated-read path
(`readCached` grows a unit argument and a comparator), a new source-taxonomy
export (`MUTABLE_VALUE_SOURCES`), a widened composer return shape
(`enrichPoolAltitudes` → `{altitudes, states, counts}` plus an `opts.droppedCount`
parameter), a new public endpoint (`POST /api/project-plans/altitudes/seen`), new
and widened structural guards in `single-writer-guard.test.js` and
`db-migration.test.js`, a client rendering surface
(`types.ts` → `api.ts` → `PlanLedgerPanel.tsx`), four locale files, and a
snapshot-baseline regeneration. Blast radius spans schema, synthesis composer,
background tick, request fast lane, structural guards, client, and docs — seven
subsystems, with an explicit **non-reorderable** dependency chain (technical-plan
§4: "Do not reorder 2 → 8") and an **amending document** on top of it (test-plan
§A, MANDATORY A-1..A-5) that *withdraws* one technical-plan step and *corrects*
another's arithmetic as defective-as-written. And it lands on
`server/lib/value-summary.js` — the single file that produced eight §9.3-family
events in the immediately prior effort, the highest recorded density in this
project's catalog.

The `fast` invocation is real but narrow in what it buys here: triage's brief
states plainly that **both** upstream plans came from full `team-intake` and
`team-qa` passes, not smoke passes, and that "full-strength verification
discipline applies; do not degrade to smoke checks." Fast mode's normal
QA-deferral default is therefore already off the table for this build — the QA
work is not deferred, it is *authored and waiting*, and the red-first core is
structural regardless.

---

## 2. Agents to run

In the calling skill's existing dependency order. All seven run.

1. **`build-triage`** — structural; already complete (brief present, verdict
   READY). No discretion.
2. **`build-planner`** — **RUNS. Does not fold.** The fold criterion is "a
   single obviously-ordered task"; this fails it on four independent counts:
   (a) seven subsystems, thirteen technical-plan steps;
   (b) an explicitly declared non-reorderable window (steps 2→8) with a stated
   physical reason per link — schema before composer stamps it, composer return
   shape before tick/route read it, server contract before client types it;
   (c) a **document-supersession** that the ordered task list must encode or the
   implementer builds withdrawn work — test-plan A-1 withdraws technical-plan
   Step 2.4 (`technical-plan.md:300-316`, the raw 5-ALTER `db.exec` block) in
   favour of `addColumnsIfMissing`, and A-1's own note says "the two amendments
   ship together or neither ships" (adopting the helper without A-2's
   `HELPER-CASE-SCAN` makes all six columns invisible to the migration
   meta-test's regex, which skips templated columns — trading a Critical defect
   for a silent §9.7);
   (d) A-3 declares technical-plan Step 9.2's route-logging arithmetic
   **defective as written** (double-counts `units.length` vs `clean.length`) and
   must not be carried forward verbatim. Folding the planner here means the
   implementer reconciles two conflicting documents live, mid-build, at exactly
   the seams where the catalog says this project breaks. The planner's job is to
   emit one reconciled ordered task list where the amendments are already
   resolved.
3. **`build-test-author`** — structural. Red-first TDD core; ~85 cases are
   pre-specified with per-case named red proofs (A1/A2/D1–D6/D5b/L1–L3/M1/M1-INT/
   M2/SEEN-1..7/C1–C3/P1/P2/ROUTE-SEAM-1/HELPER-CASE-SCAN/ALTER-BLOCK-SCAN/
   DEC-11-ANTIFIX).
4. **`build-implementer`** — structural.
5. **`build-verifier`** — structural. Note the plan's own non-negotiable
   discipline: no DoD row ticked on an agent's self-report; the only technique
   that worked all eight times in the prior effort is *revert the product change
   and run the actual shipped spec file, watching it go red*; a repaired test
   needs a fresh red proof of its own.
6. **`build-reviewer`** — **RUNS. Not skipped.** See §4 — forced back on.
7. **`build-lead`** — structural. Synthesizes the build report that
   `team-status` and any follow-up skill read.

---

## 3. Agents skipped

**None.** In `fast` + `direct` I would normally look hardest at `build-planner`
(fold if trivially ordered) and `build-reviewer` (skip if small and low-risk).
Neither qualifies here, and `build-reviewer` is independently forced on by the
defect catalog. There is no third discretionary slot in this roster.

For the record, the fast-mode "name the skipped angle so the deferred-QA
follow-up knows where to look" obligation produces an empty list for this run —
no angle is deferred.

---

## 4. Forced back on

These override any leaner call I might otherwise have made.

- **§9.3 VACUOUS-GUARD / PLAN-LEVEL VACUOUS FIXTURE / AGENT-SELF-REPORTED-RED —
  eight events in one build, on this exact file.** `server/lib/value-summary.js`
  and its sibling `value-summary-tick.js` are this catalog's named repeat-offender
  surface, including a recorded *vacuous repair of a vacuous guard*. That is the
  strongest signal this project's catalog produces. `build-reviewer` is precisely
  the independent pass that re-runs a red proof instead of reading a report
  claiming it was red — deleting it on a build re-entering that surface would be
  removing the guardrail the catalog exists to mandate. **Forced on.**
- **§9.1 DERIVED-DUAL-VIEW, twice-proven.** The durable cure (`unitFacts()` as
  the single reader, with a structural scan) must ship in test-plan A-4's
  **strong** form — per-unit identifier derived from the map callback,
  exactly-one-mention, all nine evasion classes red-proven individually — *not*
  the weaker no-dot-access form the technical-plan's own §6 text describes. That
  is a strong-vs-weak distinction a build can get subtly wrong while every test
  passes; it needs a reviewer reading the shipped guard body.
- **§9.5 FRESH-DB-BLIND / §9.6 NON-ATOMIC REBUILD.** DDL against the live shared
  DB, executed at `require()` time in four processes (server, MCP, desktop,
  VS Code extension). A helper that throws bricks all four simultaneously. The
  A-1 helper contract (per-column probe, one transaction, catch → rollback → log
  → never rethrow, `return false` if the table is absent) plus A-2's two scans is
  a correctness surface where "it passed" and "it is correct" diverge.
- **Cross-subsystem boundary.** A new public endpoint and a widened API response
  shape cross a contract two callers rely on (route path and tick path), with an
  explicit cross-path parity requirement (DEC-7 / P1 / P2) precisely because a
  normalization difference between them causes silent unbounded LLM spend that no
  existing test can see.
- **TEST-AGAINST-LIVE-DB (candidate, 3rd decline).** Every test invocation must
  set `DASHBOARD_DB_PATH`, scoped to the block that `require`s `../db`, verified
  by a **positive control** per spec — a per-file `grep` is recorded as a
  proven-invalid sweep.
- **Ordering ambiguity nothing else resolves.** The technical-plan/test-plan
  supersession (A-1 withdraws Step 2.4; A-3 corrects Step 9.2; A-5 replaces the
  unconditional `seen_at` UPDATE with a compare-and-set `AND regenerated_at IS ?`)
  has no owner if the planner folds. It is resolved on paper but not yet resolved
  *into an ordered task list*, which is the planner's deliverable.

### One carried instruction for the build, not a director decision

The build's **first action** is backing up
`~/.claude/agent-dashboard/dashboard.db` before the effort branch is booted or
tested even once (technical-plan Step 1.4 / DoD row). Triage explicitly did not
do this and states it is not a triage responsibility. A live `concurrently` dev
server (pid 79758) and a Node process (pid 59764) currently hold that DB open.

---

## 5. Ordering

`build-triage` → `build-planner` → `build-test-author` → `build-implementer` →
`build-verifier` → `build-reviewer` → `build-lead`. Unchanged from the skill's
own dependency graph; direct mode removed nothing.
