/**
 * server/lib/plan-writeback.js
 *
 * The single audited path by which the dashboard mutates a human-owned
 * AGENT-PLAN.md (DEC-2/DEC-13). Owns HOW to safely mutate the file's bytes
 * and nothing else: it never re-derives the file's syntax (imports
 * parsePlanMarkdown/the field regexes/the caps from plan-ingest.js) and
 * never writes plan_items directly (calls the real ingestPlanForCwd, which
 * remains the sole writer of plan_items/plans, including for our own
 * writes).
 *
 * Four exported functions, in one guarded sequence per DEC-14:
 *   - sanitizeLlmPlanText(input, maxLen) — the mandatory guard between an
 *     unattended LLM classification and Sara's stakeholder-facing plan file.
 *   - appendPlanItem / appendSubItem (reachable only via __testonly outside
 *     this module and applyDisposition inside it — see
 *     single-writer-guard.test.js) — low-level, synchronous file mutation
 *     with an optimistic lock against a concurrent human edit.
 *   - applyDisposition — the SOLE write-composer both DEC-13 trigger points
 *     (the human resolve route and the unattended reconciliation tick) call.
 *     Neither caller may hand-roll its own "sanitize -> dispatch -> audit ->
 *     retry -> escalate" sequence (DEC-14/§9.1 DERIVED-DUAL-VIEW).
 *
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const { atomicWriteFile } = require("./atomic-file");
const {
  PLAN_FILENAME,
  parsePlanMarkdown,
  ingestPlanForCwd,
  findItemBlockEndLine,
  fallbackItemId,
  LINE_SPLIT_RE,
  ID_LINE_RE,
  ACCEPTANCE_LINE_RE,
  DETAIL_LINE_RE,
  MAX_FILE_BYTES,
  MAX_ITEMS,
  MAX_TEXT_LEN,
  MAX_ACCEPTANCE_LEN,
  MAX_DETAIL_LEN,
} = require("./plan-ingest");

const LINE_SPLIT_GLOBAL_RE = new RegExp(LINE_SPLIT_RE.source, "g");

// ── 1. Sanitizer ─────────────────────────────────────────────────────────

/**
 * Neutralize an LLM-influenced string before it is composed into a
 * markdown block that will be appended to a human-owned file. Collapses
 * every newline boundary plan-ingest.js's own parser recognizes (imported,
 * never hand-copied — WATCH-11) to a single space, strips a forged
 * id:/acceptance:/detail: prefix, and truncates to the caller's cap
 * (imported from plan-ingest.js, never re-typed). Never throws; any
 * non-string input degrades to "" so a caller can uniformly treat empty as
 * "nothing to write."
 */
function sanitizeLlmPlanText(input, maxLen) {
  if (typeof input !== "string") return "";

  // Collapse every boundary the parser splits lines on, plus a defensive
  // catch-all for a lone \r (LINE_SPLIT_RE requires a trailing \n to match,
  // by construction, so a bare \r needs its own net).
  let s = input.replace(LINE_SPLIT_GLOBAL_RE, " ").replace(/[\r\n]/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  s = stripFieldPrefix(s);

  const cap = Number.isFinite(maxLen) && maxLen > 0 ? maxLen : s.length;
  return s.slice(0, cap);
}

// Strip a leading id:/acceptance:/detail: prefix if the collapsed string
// still looks like one of plan-ingest.js's own continuation-line fields —
// defense in depth on top of the newline collapse above (which is the
// primary guard: parsePlanMarkdown only treats id:/acceptance:/detail: as
// structural when they start their OWN line, so collapsing newlines already
// removes the mechanism; this catches the degenerate case where the entire
// sanitized field IS just such a prefix).
function stripFieldPrefix(s) {
  const idMatch = s.match(ID_LINE_RE);
  if (idMatch) return s.slice(idMatch[0].length).trim();
  const acceptanceMatch = s.match(ACCEPTANCE_LINE_RE);
  if (acceptanceMatch) return s.slice(acceptanceMatch[0].length).trim();
  const detailMatch = s.match(DETAIL_LINE_RE);
  if (detailMatch) return (detailMatch[1] || "").trim();
  return s;
}

// ── Shared helpers ───────────────────────────────────────────────────────

function sha1(text) {
  return crypto.createHash("sha1").update(text).digest("hex");
}

function mintItemId() {
  return crypto.randomBytes(4).toString("hex");
}

function backupDir(cwd) {
  return path.join(cwd, ".claude", "agent-plan-backups");
}

// ISO instant with ':' swapped for '-' (filesystem-safe), matching this
// repo's existing timestamp() idiom in cc-mutate.js. Sortable lexically.
function backupTimestamp() {
  return new Date().toISOString().replace(/:/g, "-");
}

/**
 * The dominant line ending already in use in `text`, so an append never
 * rewrites the rest of a human-owned file to a different EOL convention
 * just because we're adding one block to the end (a CRLF plan file must
 * stay CRLF end to end — S3). Ties (including the empty-file / no-newline
 * case) resolve to "\n", this repo's own default.
 */
function detectEol(text) {
  const totalLF = (text.match(/\n/g) || []).length;
  const crlf = (text.match(/\r\n/g) || []).length;
  const lfOnly = totalLF - crlf;
  return crlf > lfOnly ? "\r\n" : "\n";
}

/**
 * Timestamped backup of the pre-write file, outside PLAN_FILENAME's fixed
 * lookup so it can never be mistaken for a second live plan (WATCH-8:
 * retention/pruning deliberately not solved this round).
 */
function writeBackup(cwd, rawBefore) {
  const dir = backupDir(cwd);
  fs.mkdirSync(dir, { recursive: true });
  const backupPath = path.join(dir, `AGENT-PLAN.${backupTimestamp()}.bak.md`);
  fs.writeFileSync(backupPath, rawBefore, "utf8");
  return backupPath;
}

function composeItemBlock({ number, id, text, acceptance, detail, eol = "\n" }) {
  const lines = [`- [ ] ${number}. ${text}`, `      id: ${id}`];
  if (acceptance) lines.push(`      acceptance: ${acceptance}`);
  if (detail) lines.push(`      detail: ${detail}`);
  return lines.join(eol);
}

function composeSubItemBlock({
  parentNumber,
  subOrdinal,
  id,
  text,
  acceptance,
  detail,
  eol = "\n",
}) {
  const lines = [`  - [ ] ${parentNumber}.${subOrdinal}. ${text}`, `        id: ${id}`];
  if (acceptance) lines.push(`        acceptance: ${acceptance}`);
  if (detail) lines.push(`        detail: ${detail}`);
  return lines.join(eol);
}

// Test seam: fires between the initial read/hash and the pre-rename
// re-check, so the conflict tests are synchronous and deterministic instead
// of timing-dependent races (mirrors focus-inference.js's
// __injectSpawnForTest). A no-op until a test installs one.
let _preRenameHook = null;
function __injectPreRenameHookForTest(fn) {
  _preRenameHook = typeof fn === "function" ? fn : null;
}

// S2 correction: this is NOT a mutex. `cwdLocks` is written and deleted but
// never READ by anything, so it provides zero actual mutual exclusion on its
// own — a future async caller (e.g. a batched multi-append with an `await`
// between this module's own reads/writes) would get NO serialization
// guarantee from this map as written, contrary to what an earlier version of
// this comment claimed. What actually protects same-cwd concurrency TODAY is
// that every append function below is fully synchronous (only *Sync fs
// calls, no `await` inside `fn`), so within a single process two calls can
// never interleave mid-function — Node's single-threaded model serializes
// them by itself, with or without this map. `cwdLocks`/`withCwdLock` are kept
// as the seam a real `Map<cwd, Promise>` chain would need to fill this slot
// (keyed on the byte-identical cwd string ingestPlanForCwd/getPlanByCwd use —
// neither normalizes with path.resolve) if a genuinely async caller is ever
// added; until then, do not rely on this map for anything.
const cwdLocks = new Map();
function withCwdLock(cwd, fn) {
  cwdLocks.set(cwd, true);
  try {
    return fn();
  } finally {
    cwdLocks.delete(cwd);
  }
}

// ── 2/3. appendPlanItem / appendSubItem ──────────────────────────────────

/**
 * Shared read/pre-check/backup/re-check/write sequence for both
 * appendPlanItem and appendSubItem. `buildCandidate(parsed, rawLines, eol)`
 * must return `{ itemId, markdown, content }` or a structured
 * `{ ok:false, code }` failure (e.g. PARENT_NOT_FOUND, CAPS_EXCEEDED). Never
 * throws. Every failure return composed AFTER buildCandidate has run also
 * carries `markdown` — the exact block that was attempted — so a
 * `writeback_conflict`/`writeback_failed` decision_queue row can show Sara
 * what we tried to add (DEC-14 point 2 / B5).
 */
function appendToPlanFile(dbModule, { cwd, expectedHash, skipCheapPrefilter }, buildCandidate) {
  return withCwdLock(cwd, () => {
    const planPath = path.join(cwd, PLAN_FILENAME);

    let hashBefore;
    let rawBefore;
    try {
      rawBefore = fs.readFileSync(planPath, "utf8");
      hashBefore = sha1(rawBefore);
    } catch {
      return { ok: false, code: "NO_PLAN_FILE" };
    }

    // The reference this call proves "nothing changed" against: the
    // caller's expectedHash when given, else this call's own fresh read.
    const baselineHash = expectedHash != null ? expectedHash : hashBefore;

    // Cheap pre-filter: caller's expected hash already stale, before any
    // parsing/composition work. Skipped for applyDisposition's single retry
    // (skipCheapPrefilter) — a retry is BY DEFINITION already known-stale
    // against the disposition's original baseline, but still deserves one
    // genuine attempt through backup+re-check rather than an instant bail.
    if (!skipCheapPrefilter && expectedHash != null && expectedHash !== hashBefore) {
      return { ok: false, code: "CONFLICT", currentHash: hashBefore };
    }

    const parsed = parsePlanMarkdown(rawBefore);
    // Mirror ingestPlanForCwd's own fallback-id assignment exactly, so a
    // pre-id-convention item (no "id:" line yet) still matches the same
    // item_id its DB row was assigned on ingest — otherwise a caller passing
    // a real plan_items.item_id as parentItemId could never find its parent
    // in this fresh, in-memory re-parse.
    for (const item of parsed.items) {
      if (!item.id) item.id = fallbackItemId(cwd, item.number ?? `sub:${item.position}`);
    }
    const rawLines = rawBefore.split(LINE_SPLIT_RE);
    const eol = detectEol(rawBefore);
    const built = buildCandidate(parsed, rawLines, eol, rawBefore);
    if (built && built.ok === false) return built;
    const { itemId, markdown, content: candidateContent } = built;

    if (parsed.items.length + 1 > MAX_ITEMS) {
      return { ok: false, code: "CAPS_EXCEEDED", markdown };
    }
    if (Buffer.byteLength(candidateContent, "utf8") > MAX_FILE_BYTES) {
      return { ok: false, code: "CAPS_EXCEEDED", markdown };
    }

    if (typeof _preRenameHook === "function") {
      try {
        _preRenameHook();
      } catch {
        /* the hook itself must never crash the write path */
      }
    }

    // Optimistic lock: the real re-check. The pre-filter above is only a
    // cheap early-out — this is what actually protects a human's concurrent
    // edit (residual TOCTOU window between this and the rename is accepted
    // — WATCH-9).
    let rawNow;
    let hashNow;
    try {
      rawNow = fs.readFileSync(planPath, "utf8");
      hashNow = sha1(rawNow);
    } catch {
      return { ok: false, code: "NO_PLAN_FILE", markdown };
    }
    if (hashNow !== baselineHash) {
      return { ok: false, code: "CONFLICT", currentHash: hashNow, markdown };
    }

    // S5: the backup is taken here — immediately before the actual write —
    // rather than before the re-check above. A CONFLICT (the common case:
    // two attempts against a file a human just edited) never modifies the
    // file, so it must not leave a `.bak.md` behind either; backing up
    // BEFORE the re-check meant every conflicting attempt left an orphan
    // backup of a file that was never touched (WATCH-8's backup-retention
    // gap already accepts unbounded backups for REAL writes, but not for
    // writes that never happened). This is still `rawBefore` — the content
    // the re-check above just proved is still on disk (hashNow ===
    // baselineHash) — so the backup remains a faithful pre-write snapshot;
    // only the timing of writing it to disk moved, at the cost of a
    // (accepted, per WATCH-9) marginally later backup-vs-hook race window.
    const backupPath = writeBackup(cwd, rawBefore);

    let hashAfter;
    try {
      atomicWriteFile(planPath, candidateContent);
      hashAfter = sha1(candidateContent);
    } catch (err) {
      return { ok: false, code: "IO_ERROR", error: err.message, markdown };
    }

    let plan = null;
    let items = null;
    if (dbModule) {
      const result = ingestPlanForCwd(dbModule, cwd);
      if (result) {
        plan = result.plan;
        items = result.items;
      }
    }

    return {
      ok: true,
      itemId,
      hashBefore,
      hashAfter,
      backupPath,
      markdown,
      plan,
      items,
    };
  });
}

/**
 * Append a new top-level item at the end of the file. Never inserts into
 * plan_items directly — re-runs the real ingestPlanForCwd in-process so
 * plan_items keeps exactly one writer (db.js's own ingest upsert).
 */
function appendPlanItem(
  dbModule,
  { cwd, text, acceptance, detail, expectedHash, skipCheapPrefilter }
) {
  return appendToPlanFile(
    dbModule,
    { cwd, expectedHash, skipCheapPrefilter },
    (parsed, _rawLines, eol, rawBefore) => {
      const existingIds = new Set(parsed.items.map((it) => it.id).filter(Boolean));
      let maxNumber = 0;
      for (const item of parsed.items) {
        if (item.number != null && item.number > maxNumber) maxNumber = item.number;
      }
      const newNumber = maxNumber + 1;

      let itemId = mintItemId();
      while (existingIds.has(itemId)) itemId = mintItemId();

      const sanitizedText = sanitizeLlmPlanText(text, MAX_TEXT_LEN);
      const sanitizedAcceptance =
        acceptance != null ? sanitizeLlmPlanText(acceptance, MAX_ACCEPTANCE_LEN) : null;
      const sanitizedDetail = detail != null ? sanitizeLlmPlanText(detail, MAX_DETAIL_LEN) : null;

      const markdown = composeItemBlock({
        number: newNumber,
        id: itemId,
        text: sanitizedText,
        acceptance: sanitizedAcceptance,
        detail: sanitizedDetail,
        eol,
      });

      // S4: use the SAME read appendToPlanFile already took (rawBefore, the
      // 4th buildCandidate argument) rather than a second fs.readFileSync
      // here — a second read (a) could observe a DIFFERENT file than the one
      // `parsed`/`eol` were derived from, and (b) was not wrapped in a
      // try/catch, so a file deleted between the two reads threw straight out
      // of a function documented "never throws". Eliminating the re-read
      // removes both failure modes rather than papering over the throw.
      //
      // Join with the SAME eol the rest of the file already uses (S3) — never
      // rewrite a CRLF plan file to LF (or vice versa) just because we're
      // appending one block to the end.
      const content = `${rawBefore.replace(/\s+$/, "")}${eol}${markdown}${eol}`;

      return { itemId, markdown, content };
    }
  );
}

/**
 * Append a new sub-item immediately after its parent's own block (checkbox
 * line plus its existing continuation/sub-item lines), so SUBITEM_RE's
 * "parent must already be seen" precondition holds regardless of where the
 * parent sits in the file. Boundary lookup is delegated to plan-ingest.js's
 * findItemBlockEndLine — never a second regex pass here.
 */
function appendSubItem(
  dbModule,
  { cwd, parentItemId, text, acceptance, detail, expectedHash, skipCheapPrefilter }
) {
  return appendToPlanFile(
    dbModule,
    { cwd, expectedHash, skipCheapPrefilter },
    (parsed, rawLines, eol) => {
      const parent = parsed.items.find(
        (it) => it.id === parentItemId && it.parentNumberRef == null
      );
      if (!parent) return { ok: false, code: "PARENT_NOT_FOUND" };

      const endLine = findItemBlockEndLine(rawLines, parent.number);
      if (endLine === -1) return { ok: false, code: "PARENT_NOT_FOUND" };

      const existingIds = new Set(parsed.items.map((it) => it.id).filter(Boolean));
      let itemId = mintItemId();
      while (existingIds.has(itemId)) itemId = mintItemId();

      const subOrdinal =
        parsed.items.filter((it) => it.parentNumberRef === parent.number).length + 1;

      const sanitizedText = sanitizeLlmPlanText(text, MAX_TEXT_LEN);
      const sanitizedAcceptance =
        acceptance != null ? sanitizeLlmPlanText(acceptance, MAX_ACCEPTANCE_LEN) : null;
      const sanitizedDetail = detail != null ? sanitizeLlmPlanText(detail, MAX_DETAIL_LEN) : null;

      const markdown = composeSubItemBlock({
        parentNumber: parent.number,
        subOrdinal,
        id: itemId,
        text: sanitizedText,
        acceptance: sanitizedAcceptance,
        detail: sanitizedDetail,
        eol,
      });

      // rawLines is already split on the file's original EOLs (LINE_SPLIT_RE
      // strips them per-line); rejoin with the SAME eol detected from the
      // file (S3) — never rewrite a CRLF plan file to LF just because we
      // inserted one sub-item.
      const newLines = [
        ...rawLines.slice(0, endLine),
        ...markdown.split(eol),
        ...rawLines.slice(endLine),
      ];
      const content = newLines.join(eol);

      return { itemId, markdown, content };
    }
  );
}

// ── 4. applyDisposition ──────────────────────────────────────────────────

const RETRYABLE_CODES = new Set(["CONFLICT"]);

/**
 * The single orchestration path both DEC-13 trigger points call (the human
 * POST /api/detours/:id/resolve handler and reconciliation.js's unattended
 * tick). Neither caller composes "sanitize -> dispatch -> audit -> retry ->
 * escalate" itself — see DEC-14 / §9.1 DERIVED-DUAL-VIEW, enforced by
 * single-writer-guard.test.js.
 */
function applyDisposition(dbModule, dispositionId, opts = {}) {
  const { stmts } = dbModule;
  const row = stmts.getDetourDisposition.get(dispositionId);
  if (!row) return null;

  // Idempotent: already-written dispositions are a no-op. A second
  // unnecessary file write is itself a regression under DEC-13.
  if (row.write_status === "written") {
    return row;
  }

  if (row.disposition === "deliberate" || row.disposition === "discard") {
    // Nothing to write — resolve directly.
    stmts.markDetourWriteResult.run(
      "none",
      new Date().toISOString(),
      null,
      null,
      null,
      null,
      null,
      null,
      new Date().toISOString(),
      dispositionId
    );
    return stmts.getDetourDisposition.get(dispositionId);
  }

  const cwd = row.cwd;

  // B3 / DEC-13's own framing: the sanitizer is "the only guard between an
  // unattended LLM classification and Sara's stakeholder-facing plan file",
  // but sanitizeLlmPlanText only NEUTRALIZES forged structure — it does not,
  // by contract, reject an empty input (a non-string degrades to "").
  // parseDispositionOutput sets proposed_text to null whenever the model
  // simply omits the field, which is entirely plausible for a genuine
  // new_item/fold_in verdict. Without this check that would compose and
  // write a blank `- [ ] N. ` checkbox, report success, and leave
  // plan_items unable to re-ingest it — file and DB now disagree. Treat it
  // exactly like the other non-retryable causes (CAPS_EXCEEDED/NO_PLAN_FILE/
  // IO_ERROR): straight to write_status='failed' on the first attempt, no
  // file write attempted at all.
  const sanitizedProposedText = sanitizeLlmPlanText(row.proposed_text, MAX_TEXT_LEN);
  if (!sanitizedProposedText) {
    stmts.markDetourWritePending.run(new Date().toISOString(), dispositionId);
    const nowIso = new Date().toISOString();
    stmts.markDetourWriteResult.run(
      "failed",
      nowIso,
      "EMPTY_PROPOSED_TEXT",
      null,
      null,
      null,
      null,
      null,
      null,
      dispositionId
    );
    enqueueWritebackFailureRow(dbModule, {
      cwd,
      projectId: row.project_id,
      itemId: row.item_id,
      kind: "writeback_failed",
      dispositionId,
      message: `Automated plan write failed for detour disposition #${dispositionId}: proposed text was empty`,
      payload: { code: "EMPTY_PROPOSED_TEXT", error: null, suggested_markdown: null },
    });
    return stmts.getDetourDisposition.get(dispositionId);
  }

  stmts.markDetourWritePending.run(new Date().toISOString(), dispositionId);

  const writeArgs = {
    cwd,
    text: row.proposed_text,
    acceptance: row.proposed_acceptance,
    detail: row.proposed_detail,
  };

  const attempt = (expectedHash, skipCheapPrefilter) => {
    if (row.disposition === "fold_in") {
      return appendSubItem(dbModule, {
        ...writeArgs,
        parentItemId: row.proposed_parent_item_id,
        expectedHash,
        skipCheapPrefilter,
      });
    }
    return appendPlanItem(dbModule, { ...writeArgs, expectedHash, skipCheapPrefilter });
  };

  const freshHash = () => {
    const plan = stmts.getPlanByCwd.get(cwd);
    return plan ? plan.content_hash : null;
  };

  // First attempt's baseline: what the disposition believed the file was
  // before applyDisposition started — the caller's hash for the
  // human-resolve path, or the DB's last-ingested content_hash for the
  // unattended path (there is no "what the human last saw" otherwise).
  const baselineHash = opts.expectedHash !== undefined ? opts.expectedHash : freshHash();
  let result = attempt(baselineHash, false);

  // N2: the fresh-rebaseline retry below is ONLY safe when the first
  // attempt's baseline was this function's OWN internal read
  // (freshHash() — the unattended reconciliation-tick path, where there is
  // no "what the caller last saw" to honor). When the CALLER explicitly
  // supplied expectedHash (the human-resolve route, server/routes/detours.js
  // ~line 106), that hash IS a real optimistic-concurrency token: "the file
  // I looked at before deciding this disposition." A CONFLICT against that
  // specific hash means the file changed since the human looked at it, and
  // must be honored as a real conflict — silently re-baselining against
  // whatever the file happens to be right now and writing anyway would
  // append a duplicate item the human may have already added by hand.
  const firstAttemptWasInternallyBaselined = opts.expectedHash === undefined;

  if (
    result.ok === false &&
    RETRYABLE_CODES.has(result.code) &&
    firstAttemptWasInternallyBaselined
  ) {
    // B4: retry exactly once, immediately, against a FRESH baseline —
    // passing no expectedHash makes appendToPlanFile derive baselineHash
    // from its OWN read of the file taken at the top of THIS attempt, not
    // the first attempt's now-stale reference. Reusing the first attempt's
    // baseline here was self-defeating: a real, ingested plan always has a
    // non-null plans.content_hash, so on a genuine transient conflict with
    // NO further external edit, attempt 2 would still recompute its own
    // fresh hashNow and compare it against the SAME already-known-mismatched
    // baseline — guaranteeing a second CONFLICT even when nothing external
    // touched the file between the two attempts. The retry's own optimistic
    // re-check (appendToPlanFile's pre-rename re-hash) still catches a
    // genuine SECOND edit landing during the retry's own window — that is
    // the accepted WATCH-9 bound, now measured from the retry's own start.
    result = attempt(null, true);
  }

  const nowIso = new Date().toISOString();

  if (result.ok) {
    stmts.markDetourWriteResult.run(
      "written",
      nowIso,
      null,
      result.itemId,
      result.markdown,
      result.backupPath,
      result.hashBefore,
      result.hashAfter,
      nowIso,
      dispositionId
    );
    if (typeof opts.broadcast === "function" && result.plan) {
      opts.broadcast("plan_updated", { plan: result.plan, items: result.items });
    }
    return stmts.getDetourDisposition.get(dispositionId);
  }

  // Failed. CONFLICT (after the retry) escalates distinctly from a
  // non-retryable failure, but both leave resolved_item_id/resolved_at NULL.
  // B5: suggested_markdown carries the EXACT block that was attempted (when
  // buildCandidate got far enough to compose one) so a writeback_conflict/
  // writeback_failed queue entry can show Sara what we tried to add.
  const writeStatus = result.code === "CONFLICT" ? "conflict" : "failed";
  stmts.markDetourWriteResult.run(
    writeStatus,
    nowIso,
    result.code || "IO_ERROR",
    null,
    result.markdown || null,
    null,
    null,
    null,
    null,
    dispositionId
  );

  enqueueWritebackFailureRow(dbModule, {
    cwd,
    projectId: row.project_id,
    itemId: row.item_id,
    kind: writeStatus === "conflict" ? "writeback_conflict" : "writeback_failed",
    dispositionId,
    message: `Automated plan write ${writeStatus} for detour disposition #${dispositionId}`,
    payload: {
      code: result.code,
      error: result.error || null,
      suggested_markdown: result.markdown || null,
      current_hash: result.currentHash || null,
    },
  });

  return stmts.getDetourDisposition.get(dispositionId);
}

/**
 * The single anti-duplicate guard for both writeback_conflict and
 * writeback_failed queue rows (S1 / §9.1 DERIVED-DUAL-VIEW). Delegates to
 * the SAME `enqueueIfNotOpen` reconciliation.js uses for pace_alert/
 * detour_volume/detour_disposition rows — this module used to hand-roll its
 * own copy that probed `findOpenQueueItem` with a literal `null` item_id
 * while the insert stored `row.item_id`, so a disposition carrying a real
 * item_id never matched its own prior insert and every retry produced a
 * fresh duplicate row.
 */
function enqueueWritebackFailureRow(
  dbModule,
  { cwd, projectId, itemId, kind, dispositionId, message, payload }
) {
  require("./decision-queue-enqueue").enqueueIfNotOpen(dbModule, {
    cwd,
    projectId,
    kind,
    refId: dispositionId,
    itemId,
    message,
    payload,
  });
}

module.exports = {
  sanitizeLlmPlanText,
  applyDisposition,
  __testonly: {
    appendPlanItem,
    appendSubItem,
  },
  __injectPreRenameHookForTest,
};
