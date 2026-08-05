# Product Owner Assessment — Slice 1: Mutability-aware altitude-cache invalidation

**Intake:** `2026-08-04-altitude-invalidation`
**Assessed:** 2026-08-04
**Verdict:** IN SCOPE, approved, build it. Priority: high within the value-pool
roadmap (it is the foundation slice and fixes a live honesty defect).

---

## 1. Value & intent

The Value Pool's per-unit PROJECT/STAKEHOLDER text is the layer Sara reads to
answer "what did this work actually deliver?" Today that text is generated
once and served forever — correct for commit-keyed units (a SHA never
changes), but **silently wrong for initiatives and detours**, whose stage and
label move on. The live proof exists right now: the Resume project's
`2026-08-03-job-pipeline-tracker` unit says "The job pipeline tracker is
built and being tested" and will keep saying that after the tracker ships.

The outcome Sara wants is **a dashboard that never lies about mutable work**,
and — her own framing, load-bearing for this slice — a UX that "must always
tell the user what's happening, how long it will take, and when something
they saw before has changed." Slice 1 delivers the third clause. It is also
the trust foundation for slices 2–4: auto-grouping (slice 3) synthesizes over
these per-unit texts, so grouping over stale text would propagate the lie
upward into group summaries and plan claims.

## 2. Scope check

- **Inside approved scope.** Sara approved the four-slice vision verbally
  2026-08-04 ("ok, lets build this"); the written record is
  `requests/2026-08-04-value-pool-grouping/request.md`, whose Slice 1 section
  is quoted verbatim in this intake's request-brief §1. The orchestrator's
  scope ruling (Slice 1 only) matches the request's own "slices ship
  independently, in order" constraint. No conflict.
- **One deliberate reversal of a documented decision, already authorized:**
  `server/db.js`'s `value_unit_summaries` schema comment (lines 821-825)
  asserts "NOT a content digest like focus_summaries … generated once,
  served forever." That was a real, signed-off decision of the prior effort —
  and this request explicitly overturns it for mutable unit kinds.
  **Acceptance requirement:** the comment must be rewritten in the same
  change so the docs stop asserting the old contract (the brief's §4 already
  flags this; I am making it a done-criterion, not a nice-to-have).
- `PROJECT-CONTEXT.md` is an engineering defect catalog, not a business
  source-of-truth; for this initiative the source of truth is `request.md`
  itself. The marker copy "updated — stage changed" written there is the
  approved wording (see §5 and §6 below).
- **Not a regression fix** in the blame sense: generate-once was deliberate
  and documented. The provisional `new-feature` typing is fine; I read it as
  new-feature-that-retires-a-latent-correctness-defect. Nothing hangs on the
  label.

## 3. Acceptance criteria ("done when…")

The Resume unit is the walkthrough proof — AC-2 must be demonstrated on it
(or an exact fixture replica of it), not on a synthetic-only case.

1. **AC-1 (no regression on immutable units).** `trunk_commit` /
   `merge_commit` units behave exactly as today: generated once, served
   forever, never digest-gated. A NULL digest on an immutable unit is not
   staleness.
2. **AC-2 (the motivating walkthrough).** Given the Resume project's
   `2026-08-03-job-pipeline-tracker` unit with its stale cached text
   "The job pipeline tracker is built and being tested": advance that
   initiative's stage → on the next tick or next view of the pool, **that
   one unit's** text regenerates and reflects the new stage. No other unit
   regenerates because of it. Same behavior for a label rewrite, and for
   `detour` units.
3. **AC-3 (pre-digest rows heal).** Existing cached rows for mutable units
   (all pre-date the digest column) are treated as stale on first check and
   regenerate lazily. Explicitly: **no backfill stamping** — backfilling
   digests from *current* stage/label would mark the known-stale Resume row
   as fresh and defeat AC-2. (This is my ruling on open item A; see §5.)
4. **AC-4 (the user is told).** A regenerated unit shows a visible
   "updated — stage changed" marker in the Plan Ledger until Sara has seen
   it. "Seen" is server-side: once she has viewed the updated unit in any
   browser/device, the marker is gone in all of them and stays gone across
   reloads; until then it appears everywhere the unit renders. (My ruling on
   open item B; see §5.)
5. **AC-5 (honest interim states).** The window between "inputs changed" and
   "new text generated" is a named, server-authored wire state per §9.8 /
   DEC-10 — never a silent absence and never the old text presented as
   current with no signal. Showing the old text *with* a pending/queued
   indication is acceptable; showing it bare is not.
6. **AC-6 (auditable reason).** Each invalidation lands in
   `value_summary_generation_log` with a reason such that Sara (or QA) can
   answer, per unit, "why did this text change and when?" Column shape is
   engineering's call (item C); the recoverable-per-unit answer is the
   requirement.
7. **AC-7 (docs match behavior).** The `db.js` schema comment and any docs
   describing the generate-once contract are rewritten in the same change.

## 4. Priority & impact

- **Who is affected:** Sara, the sole user — but on the surface she uses to
  reconcile delivered value into plans, which her portfolio-reconciliation
  direction makes a first-class workflow. A ledger that shows stale
  "in progress" text for shipped work directly corrupts that reconciliation.
- **Visibility:** high — PlanLedgerPanel text is read, not just glanced at;
  the defect is invisible *as a defect*, which is the worst kind (it reads
  as truth).
- **Urgency:** build next, ahead of slices 2–4 — they are explicitly
  sequenced behind it, and slice 3's grouping quality depends on per-unit
  text being current. Not an emergency (nothing is down), so it does not
  jump ahead of unrelated in-flight work.

## 5. Rulings on the brief's §9 open items (value/UX perspective)

- **Item B — "seen" state lives server-side.** This follows from Sara's own
  words, not from taste: the marker exists "until **seen**," and "seen"
  describes Sara-the-person, not a browser profile. She is a single user on
  a local-first dashboard, but multi-device use is real, not hypothetical —
  the repo just shipped LAN hosting of the dev server (`23cabdc`) precisely
  so the dashboard can be viewed from other devices. Client-local state
  would (a) re-show "updated" on every other device after she's already
  seen it — the marker would be lying about her own state of knowledge, the
  exact sin this slice exists to fix — and (b) evaporate on storage clears.
  Server-side also aligns with DEC-10's server-authored-state principle and
  §9.8 (regenerated-unseen becomes a named wire state, not a client
  heuristic). The mark-seen mechanism (render-triggered vs. explicit
  dismiss) is engineering's call; the PO requirement is only: *seen once
  anywhere = seen everywhere, permanently*. A one-click "dismiss all
  updated markers" is acceptable if cheap; a notification center is not
  wanted.
- **Minimum honest invalidation UX (Sara: "how are we communicating to the
  user that we had to invalidate because things changed").** Two pieces,
  and only two:
  1. the per-unit until-seen marker whose copy names the cause class —
     "updated — stage changed" (or "label changed" when that's the trigger;
     if the changed field genuinely can't be attributed, an honest generic
     "updated — details changed" beats a wrong specific);
  2. the generation-log reason for after-the-fact audit (no UI over the log
     required this slice — reading it via SQL/CLI is fine for a single-user
     local tool).
  **Over-engineering for this tool, explicitly not wanted in slice 1:**
  toasts/push notifications, an invalidation history or notification-center
  UI, old-vs-new text diffs, retained copies of superseded text, per-unit
  changelogs, badge counts. If future use shows a need, that's a new ask.
- **Item A — stale-on-first-check, no backfill.** Ruled in AC-3. The
  one-time regeneration burst covers mutable units only and the request's
  own measured economics (~$0.001/unit, 182-unit backfill ≈ 20¢) make cost
  a non-issue; sizing it against real pool composition is due diligence,
  not a gate.
- **Item C — no PO constraint beyond AC-6.** Additive nullable column,
  no CHECK widening/table rebuild, per the brief's stated assumption —
  fine. The per-run vs. per-unit granularity mismatch is engineering's to
  resolve; the user-facing bar is only that the per-unit "why" is
  recoverable.
- **Item D — heal staleness wherever she encounters it.** From the user's
  seat there is no reason to exclude the request-path fast lane: the best
  UX is that *viewing* the panel is the fastest way stale text gets fixed.
  If digest gating in the shared read path gives that for free, do not
  deliberately suppress it. The WATCH-6/WATCH-7 writer-guard implications
  are engineering's, to be widened deliberately per the standing
  constraint.
- **Item E** — environment hygiene (fast-forward, concurrent-session
  check); no PO position beyond "yes, follow the repo's known
  concurrent-session rule."

## 6. Stakeholder questions (sign-off needed before/at delivery)

1. **Marker copy.** "updated — stage changed" is Sara's approved wording in
   `request.md` — the delivered UI must match it (with the "label changed"
   variant as the natural extension of the same approved pattern). If build
   or design wants different copy, that is a content change and must be
   reflected back in `request.md`, not just shipped in the component.
2. **Item B confirmation-in-passing.** I've ruled server-side "seen" from
   Sara's own wording and usage; no blocking sign-off needed, but state the
   ruling in the walkthrough so she can veto cheaply if she actually wanted
   per-browser behavior.
3. **OPEN-2 carry-over (prior effort, still PENDING Sara):** validation
   project choice. This slice's walkthrough is fixed on the Resume example
   by the request itself, so OPEN-2 does not block here — just don't let it
   silently close.
4. No other sign-offs: the design, tables, precedent pattern, and scope
   fence were all approved verbally 2026-08-04 and are written down.

## 7. Scope guard — named slice 2–4 territory (do NOT let slice 1 absorb)

If any of these appear in slice 1's plan or diff, it has grown; cut it back:

- **Slice 2:** coverage requests / rotation jumping / continuous drain;
  coverage header and ETA display ("N of M described · ~X min"); real
  per-batch-duration ETAs; auto-group gating UX ("disabled until 100%");
  the OPEN-3 client WebSocket subscriber (slice 1's marker may rely on
  reload/poll — in-place live updates are explicitly slice 2); model
  tiering / haiku-vs-sonnet calibration; `MAX_PROJECTS_PER_TICK` tuning
  (OPEN-4 — reconcile there, not here).
- **Slice 3:** any grouping — mechanical pre-grouping, LLM group proposals,
  the `value_groups` table.
- **Slice 4:** plan editing UI (items/sub-items), claim-target picker,
  batch group claiming.
- **Also out (from §5 above):** any notification/history UI beyond the
  single until-seen marker plus the log reason.

Standing constraints that *do* bind slice 1: `assembleValuePool` remains the
sole pool composer (DEC-16/`CONSUMERS`); writer guards widen deliberately
(WATCH-6 pattern); §9.8 named states for every new absence.
