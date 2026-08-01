#!/bin/bash
# capture-claude-usage.sh — launches `claude` inside a detached tmux session,
# sends /usage, captures the rendered pane as plain text (no OCR), and
# prints/saves the result. Ad hoc local utility, not part of the app itself.
# @author Son Nguyen <hoangson091104@gmail.com>
#
# Run this in a REAL terminal you control directly — not through another
# agent's sandboxed shell — since nested-pty capture didn't work reliably
# from inside a sandboxed Bash tool call.
#
# Requires tmux. If you don't have it: brew install tmux
#
# Usage:
#   ./capture-claude-usage.sh
#
# Output is saved to ./usage_snapshot_<timestamp>.txt and printed to stdout.

set -euo pipefail

if ! command -v tmux >/dev/null 2>&1; then
  echo "tmux not found. Install it with: brew install tmux" >&2
  exit 1
fi

if ! command -v claude >/dev/null 2>&1; then
  echo "claude CLI not found on PATH." >&2
  exit 1
fi

SESSION="ccusage_$$"
OUTFILE="usage_snapshot_$(date +%Y%m%d_%H%M%S).txt"

cleanup() {
  tmux kill-session -t "$SESSION" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "Starting claude in tmux session '$SESSION'..."
tmux new-session -d -s "$SESSION" -x 220 -y 50 "claude"

# Give claude time to boot before sending input.
sleep 5

echo "Sending /usage..."
tmux send-keys -t "$SESSION" "/usage" Enter

# Give the usage panel time to fetch + render.
sleep 4

echo "Capturing pane..."
tmux capture-pane -t "$SESSION" -p > "$OUTFILE"

# Back out of the /usage panel and exit claude cleanly.
tmux send-keys -t "$SESSION" Escape
sleep 1
tmux send-keys -t "$SESSION" C-c
sleep 1

echo "=== Captured usage panel ($OUTFILE) ==="
cat "$OUTFILE"
