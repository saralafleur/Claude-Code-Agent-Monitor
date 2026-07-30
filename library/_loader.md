# Library — Loader & Contribution Rules

This folder is the **durable knowledge library**. It exists so we stop
re-deriving how our systems work and can get close to one-shot on repeat work.

## For any agent doing work (how to READ)
1. If the **Table of Contents is already in your context, do NOT re-read it.**
2. If it is not, read `TABLE-OF-CONTENTS.md` **once**.
3. Load only the entries whose **description** matches your task — not the whole
   library.
4. If you needed knowledge that exists but whose description didn't lead you to
   it, that is a retrieval miss worth reporting to `/librarian audit`.

## For contributing knowledge (how to WRITE)
You do **not** write here directly. Knowledge enters only through the **librarian**:
- `/librarian capture` — proposes new/updated entries from a conversation.
- `/librarian audit` — proposes description/taxonomy/process improvements.

Every write passes a **human approval gate** and is recorded in `audit/`. The
`librarian-archivist` is the only writer.

## What belongs here (durable knowledge)
- How a system/component actually works.
- How we accomplished something reusable (e.g. Playwright flows, the archive
  utility, build/run procedures).
- Architectural decisions and the **direction** we chose, with rationale.
- How a solution solved a problem; style guide; how we work with UI controls;
  best practices and conventions.

## What does NOT belong here
- One-off task state, secrets, transient debugging, or anything already captured
  by the repo (code, git history, CLAUDE.md). If it won't help us repeat an
  activity later, it isn't library knowledge.

## Scope of this library
This library is scoped to the Claude-Code-Agent-Monitor project (a local-first
dashboard for monitoring Claude Code agent sessions: hooks -> Express API ->
SQLite -> WebSocket -> React UI, plus an MCP server and a CLI). Library root:
`/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor/library`.
