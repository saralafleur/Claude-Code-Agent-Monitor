# Product Owner Assessment: Trunk-drift detection (detection step only)

Source docs reviewed: `intake/2026-08-02-trunk-drift-detection/request-brief.md`,
`request-source.md`; grounding docs: `PROJECT-CONTEXT.md`,
`intake/2026-08-01-build-project-manager/` (`pm-plan.md`, `technical-plan.md`,
`decisions.md`), the `portfolio-reconciliation-vision` memory,
`intake/2026-07-31-focus-untracked-commits/`, `server/db.js`,
`server/lib/reconciliation.js`, `client/src/pages/ProjectManager.tsx`.

## 1. Value & intent

Today the entire portfolio-reconciliation model (declared activity → detour
disposition → pace → reconciliation, layers 3-6, built 2026-08-01) is keyed
off the Claude Code hook event stream. It only sees work that happened inside
a session that ran hooks and declared (or was inferred to have) focus. A
human committing directly to `main`/`master`, or a session that never called
`ccam focus`, is **structurally invisible** to the dashboard today — not a bug
in the existing build, a genuine blind spot in what layers 1-6 can see at
all.

This isn't hypothetical: `intake/2026-07-31-focus-untracked-commits/` is a
real, already-documented incident where `team-status` caught seven commits
that had shipped real feature/bug work directly to trunk with no
`team-intake` folder and no declared focus — discovered only by a manual
reconciliation pass, after the fact. The outcome Sara actually wants is: stop
finding this kind of thing by accident during a manual audit; have the
dashboard surface it automatically, the same way it already surfaces an
undispositioned session-derived detour. The end-user (Sara, as the one
person running a portfolio of 8-10 concurrent projects) is the direct
beneficiary — this is squarely the "answer where are we without
micromanaging every session" problem the whole reconciliation model exists to
solve, applied to the one gap it currently has.

## 2. Scope check

**In scope, and consistent with confirmed direction — not a new ask.**

- The project's own memory (`portfolio-reconciliation-vision`, confirmed
  2026-08-01) records layers 1-6 as built and layer 7 (portfolio rollup UI)
  as the only deliberately-deferred piece. This request does not touch layer
  7. It adds a **third detour source** into the already-built layer 4
  (`detour_dispositions.source`, today `"inferred"` / `"declared"`) — additive
  within an existing layer, not a new layer, exactly as the request brief and
  source doc both characterize it, and I concur with that framing after
  reading the schema directly (`server/db.js` line ~734: unique index
  `(cwd, source, source_ref)` — already designed to be source-polymorphic).
- The request explicitly and repeatedly declines to touch the parts of
  layers 4-6 that are "confirmed reusable as-is" per the 2026-08-01 build:
  `fold_in`/`new_item`/`deliberate`/`discard` vocabulary, `plan-writeback.js`,
  `decision_queue`. I verified this boundary is drawn correctly — nothing in
  the restated ask requires touching those. Good scope discipline; nothing to
  push back on here.
- **One real scope tension worth flagging, not blocking:** the 2026-08-01
  build's own status note says layer 6's "remaining open item" is **DEC-7's
  live-trial gate** — Sara was supposed to review real decision-queue output
  and real unattended `AGENT-PLAN.md` writes from the *existing* detour
  sources before that build is considered fully done. Nothing in this
  request or its source doc mentions whether that trial has happened. Adding
  a second, higher-volume, mechanically-generated detour source
  (`trunk_drift` — every unattributed commit range, not just sessions that
  drift) into a pipeline whose live-trial sign-off is still open increases
  what's riding on that unresolved checkpoint. This doesn't make the request
  out of scope; it's a sequencing question for the stakeholder (see §5).
- **No contradiction found** against any approved decision, business
  requirement, or signed-off spec. `decisions.md` in the 2026-08-01 intake is
  the closest thing this project has to a scope-decision source of truth for
  this subsystem, and I read it end to end — nothing there says detour
  sources are closed to hook-derived events only, and DEC-2/DEC-13 (real,
  auto-fired writeback) actually make a trunk-derived source *more*
  consequential to get right, not out of bounds.
- This is a **new-feature** request, not a missed-requirement against the
  2026-08-01 build. I read the actual pm-plan/technical-plan for that build
  and confirm it scoped hook-derived detours only; a trunk-commit-history
  walker was never in that plan's stated scope, so there's no history to
  "reconstruct" — this is new capability, correctly triaged as such in the
  request brief.

## 3. Acceptance criteria (user-facing, testable — detection step only)

Given "no classification judgment happens in this step" is a hard,
non-negotiable boundary (confirmed twice in the source doc, in both the main
narrative and "Explicit non-goals"), the acceptance bar for *this* request is
narrower than "trunk drift gets fixed" — it is "trunk drift becomes visible,
in the same place and the same way existing detours are visible, with
correct content and no duplicates." Concretely, done when:

1. **Detection fires correctly.** For a repo with commits sitting directly on
   its default branch that no `detour_dispositions`/`focus_inferences` row
   has yet marked as seen, the detector reports that unattributed range
   exists — and does **not** fire for a repo whose trunk has no such commits
   (e.g. every commit already landed via a tracked worktree/focus flow, or
   the branch is simply clean).
2. **Output is descriptive enough to read, not just to key on.** The
   detector's output includes the commit range and enough content (commit
   messages, and diff or diff summary) that a person — or the existing
   `buildDispositionPrompt` LLM pass, later — could describe in plain
   language what happened without re-deriving it from raw git output. This
   is Sara's own stated minimum bar from the source doc; treat it as a
   literal acceptance test, not aspirational.
3. **It reaches the existing pending/unqualified badge, unchanged.** Once
   plumbed (even minimally) into `detour_dispositions` as a new `source`
   value, a trunk-drift entry must appear through the **same** rendering
   path that an "inferred"/"declared" pending detour already uses today —
   concretely, `client/src/pages/ProjectManager.tsx`'s `decision_queue`
   `detour_disposition` kind badge and the `pendingQueue` count tile. No new
   badge component, no visually distinct treatment. "Looks the same as any
   other undispositioned detour until it's qualified" (Sara's own phrase) is
   the literal UI acceptance criterion — a build that renders a different
   badge, label style, or a separate list fails this criterion even if the
   underlying detection logic is correct.
4. **No classification leaks in.** The detector's output must not contain,
   compute, or imply a `fold_in`/`new_item`/`deliberate`/`discard` verdict,
   a plan-item match, or any judgment about whether the drift is "fine" or
   "a problem." That entire judgment stays inside the existing
   `buildDispositionPrompt`/LLM pass, untouched. A code review finding any
   plan-matching logic inside the new detector module is a scope-boundary
   failure, not a nice-to-have gap.
5. **No duplicate entries on repeat detection.** Because the detector is
   explicitly live-computed/uncached (matching `repo-topology.js`'s
   posture), the same trunk-drift range will be recomputed on every
   invocation. Re-running detection against an already-seen commit range
   must not create a second pending `detour_dispositions` row for the same
   range — this needs a deterministic, stable `source_ref` and reliance on
   the existing `(cwd, source, source_ref)` unique index, proven by a test
   that runs detection twice and asserts one row, not two.
6. **Local-first posture preserved.** Detection works entirely from local
   git state (no GitHub API call, no network dependency introduced) —
   consistent with this repo's own stated mission ("local-first dashboard")
   and with `repo-topology.js`'s existing precedent. A build that requires
   a remote API token or network round-trip to determine the default branch
   or read commit content fails this criterion.

Non-goals for acceptance (explicitly do NOT test for these under this
request): whether a detected range gets correctly classified as
fold_in/new_item/deliberate/discard; whether `plan-writeback.js` writes
anything correctly for a trunk-drift-sourced detour; whether the periodic
`reconciliation.js` pass is wired to invoke the new detector automatically
versus only on-demand (real design decision for the tech plan, not an
acceptance gate for this request, per the source doc's own framing).

## 4. Priority & impact

- **Who's blocked:** Sara, as the sole consumer of this dashboard's
  portfolio-altitude view. Not team-blocking (single-operator tool), but
  directly blocks the stated goal of running 8-10 concurrent projects
  without falling back to manual session-by-session auditing — that's the
  problem the whole reconciliation model exists to solve, and this is a
  known, already-triggered hole in it.
- **Visibility:** High to Sara, invisible to anyone else — there is no other
  stakeholder audience for this internal tool.
- **Urgency rationale:** Not an incident (nothing is on fire), but it is a
  **recurring, evidenced failure mode**, not a hypothetical: one real
  incident already required a retroactive manual intake
  (`2026-07-31-focus-untracked-commits/`) to catch. Every day this detector
  doesn't exist, the same class of gap can recur silently, only found by
  another manual `team-status` sweep. I'd frame priority as **medium-high,
  not urgent**: worth doing soon given it's a known recurring gap with a
  real precedent, but nothing forces same-day treatment, and the sequencing
  question in §5 is a legitimate reason to gate the start date, not the
  priority ranking itself.
- **Effort/impact shape:** The request itself is scoped tightly (one new
  detector module + minimal plumbing into an already-built lifecycle), which
  keeps the effort-to-value ratio favorable — this is exactly the kind of
  narrow, additive extension the 2026-08-01 build's own architecture was
  designed to accommodate (the `source` column and its unique index were
  clearly built anticipating more than two sources).

## 5. Stakeholder questions (need Sara's sign-off before build starts)

1. **Sequencing against DEC-7's open live-trial gate.** The 2026-08-01
   build's memory record says the live-trial review of real decision-queue
   output and real unattended `AGENT-PLAN.md` writes was still pending as of
   that build's close. Has that trial happened? If not, does Sara want it
   resolved *before* a second, likely higher-volume detour source starts
   feeding the same auto-write pipeline (DEC-13: writes fire immediately and
   unattended) — or is she comfortable having trunk-drift entries be part of
   what that trial reviews? This is a real ordering decision, not a
   formality: an auto-write pipeline that hasn't been trial-reviewed once
   is a higher-stakes thing to point a second, noisier input at.
2. **Default-branch detection method — confirm the local-only assumption.**
   The request brief's own open question #1 (git `symbolic-ref`/`origin/HEAD`
   vs. a hardcoded `main`/`master` fallback list) needs an explicit answer
   from Sara before build, specifically to rule out any GitHub API
   dependency being introduced without her sign-off — this repo's
   local-first mission statement is a real constraint, not a style
   preference, and should be treated as a hard requirement in the tech plan
   unless Sara explicitly waives it.
3. **Trigger/frequency (on-demand only, periodic, or both).** Confirmed
   as non-blocking for scoping in the request brief, but it does change
   user-facing behavior meaningfully: if detection only runs when the
   Project Detail page is opened, trunk drift on a project Sara isn't
   actively looking at won't reach the decision queue until she visits that
   page — which partially undercuts the "stop finding this by accident"
   value proposition from §1. Worth Sara explicitly choosing rather than
   letting the tech plan default to whichever is easier to build.
4. **This is not a content/source-of-truth change**, so the usual
   "does the delivered output match the approved source wording" acceptance
   frame doesn't apply here — flagging that explicitly so downstream
   reviewers don't go looking for a content doc to diff against. The
   closest analog to a source-of-truth constraint is the scope boundary
   itself (§2/§3 above), which is already pinned down in
   `request-source.md`'s "Confirmed scope boundary" section and should be
   treated with the same weight as an approved spec — any build that drifts
   past it needs to come back to Sara as a separate request, not get folded
   in silently.
