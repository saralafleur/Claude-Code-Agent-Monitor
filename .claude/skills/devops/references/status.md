# status — devops skill status report

Goal: one read-only report answering "what state is everything the devops
skill manages in right now?" Never installs, fixes, or changes anything.

## Procedure

1. **Discover** — enumerate every audit script in this skill's `scripts/`
   directory (`scripts/*-check.sh`). `desktop-setup-check.sh` belongs to
   `desktop-setup`; `web-setup-check.sh` belongs to `web-setup`.
   `desktop-check.sh` is shared by `desktop-build` and `desktop-remove` —
   report those two together under one section. `web-check.sh` is shared
   by `web-build`, `web-up`, `web-down`, and `web-restart` — report those
   four together under one section. `docker-check.sh` is shared by `docker-up` and
   `docker-down` — report those two together under one section. No shared
   script's commands get repeated tables.

2. **Run** — execute each audit script (they are all read-only and exit 0):

   ```bash
   zsh <skill-base-dir>/scripts/desktop-setup-check.sh
   zsh <skill-base-dir>/scripts/desktop-check.sh
   zsh <skill-base-dir>/scripts/web-setup-check.sh
   zsh <skill-base-dir>/scripts/web-check.sh
   zsh <skill-base-dir>/scripts/docker-check.sh
   ```

3. **Report** — for each command show:
   - A one-line verdict: **ready** (all build-relevant rows `ok`),
     **partial** (some `ok`, some not), or **not set up** (core rows
     MISSING/WRONG).
   - The full audit table (or, if long, only the non-`ok` rows plus a count
     of healthy ones).
   - If unhealthy: the exact command to fix it (e.g. `/devops desktop-setup`,
     `/devops web-setup`, `/devops web-build`).

4. **Git worktree & branch status** — this project is a git repo, so always
   report one row per `git worktree list` entry: path, current branch,
   sync state vs `origin` (ahead N / behind N / in sync), working-tree
   cleanliness (clean / N modified, M untracked), and whether the branch is
   merged into the default branch (`master`). Same table shape the
   `wrap-up` skill uses for its own orientation table — keep them
   consistent.

   ```bash
   default_branch="$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's#origin/##')"

   git worktree list --porcelain | awk '/^worktree /{print $2}' | while read -r wt; do
     branch="$(git -C "$wt" symbolic-ref --short -q HEAD || git -C "$wt" rev-parse --short HEAD)"
     upstream="$(git -C "$wt" rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null)"
     if [ -n "$upstream" ]; then
       counts="$(git -C "$wt" rev-list --left-right --count "$upstream...HEAD" 2>/dev/null)"
     fi
     dirty_count="$(git -C "$wt" status --porcelain | wc -l | tr -d ' ')"
     merged="$(git -C "$wt" branch --merged "$default_branch" 2>/dev/null | grep -qx "  $branch\|\* $branch" && echo yes || echo no)"
     echo "$wt | $branch | $counts | $dirty_count | $merged"
   done
   ```

   Treat the row for `master` itself as `n/a — already default` in the last
   column rather than running the merge check against itself.

5. **Extras worth including when relevant** (cheap, read-only): whether the
   desktop app is currently running (`app-running` row) and whether its
   data/logs exist on disk (relevant if Sara later runs `desktop-remove`);
   whether the web dev server is currently running and on what port
   (`web-running` row); whether the `agent-monitor` Docker container is
   currently running and on what port (`docker-running` row). When
   surfacing a URL from either row, label it — `web-running` is
   **(hot-reload)**, `docker-running` is **(built-docker)** — so the two
   are never ambiguous when both are live at once (see `web-lifecycle.md`
   / `docker-lifecycle.md`).

## Report format

```
## /devops status

| Command | Verdict | Fix |
|---|---|---|
| desktop-setup | ✅ ready | — |
| desktop-build / desktop-remove | ✅ ready | — |
| web-setup | ✅ ready | — |
| web-build / web-up / web-down / web-restart | ✅ ready | — |
| docker-up / docker-down | ✅ ready | — |

<details per command: audit table or non-ok rows>

### Git worktree & branch status

| Location | Branch | vs `origin` | Working tree | Merged into default? |
|---|---|---|---|---|
| `<path>` | `<branch>` | ahead N / behind N / in sync | clean / N modified, M untracked | yes (`<sha>`) / no / n/a — already default |
```

Keep it scannable — verdicts first, detail after.
