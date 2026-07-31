-- Opens a new Terminal.app window and runs two shell commands in it in
-- sequence (used to `cd` into a session's working directory, then start a
-- fresh `claude` instance there as a distinct, separately-submitted command
-- rather than one chained `cd ... && claude` line).
-- Invoked as:
--   osascript open-terminal-session.applescript <cd-command> <claude-command>
-- Both commands are built server-side (server/lib/terminal-focus.js), with
-- the target directory already shell-quoted there, and passed as separate
-- argv elements (never interpolated into this script's source), so this
-- file itself has no injection surface.
on run argv
	set cdCommand to item 1 of argv
	set claudeCommand to item 2 of argv
	tell application "Terminal"
		activate
		set newTab to do script cdCommand
		do script claudeCommand in newTab
	end tell
end run
