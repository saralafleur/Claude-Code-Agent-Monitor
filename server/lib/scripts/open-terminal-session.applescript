-- Opens a new Terminal.app window and runs a shell command in it (used to
-- start a fresh `claude` instance in a session's working directory).
-- Invoked as:
--   osascript open-terminal-session.applescript <shell-command>
-- The shell command is built server-side (server/lib/terminal-focus.js),
-- with the target directory already shell-quoted there, and passed as a
-- single argv element (never interpolated into this script's source), so
-- this file itself has no injection surface.
on run argv
	set shellCommand to item 1 of argv
	tell application "Terminal"
		activate
		do script shellCommand
	end tell
end run
