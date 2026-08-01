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
--
-- Two race guards, both aimed at the same symptom (claude launching before
-- the `cd` has actually landed):
--   1. If Terminal.app wasn't already running, `activate` triggers a cold
--      launch, which can restore the user's previous windows/tabs (macOS's
--      "reopen windows" behavior) at the same time this script is creating
--      its own new one. Giving that a moment to settle first means our
--      `do script` isn't racing Terminal's own startup windows for which
--      tab is "newTab".
--   2. Between the two `do script` calls, poll the tab's `busy` property
--      (true while its shell is still starting up / running a command)
--      before submitting `claude`, so a slow shell startup (nvm, oh-my-zsh,
--      direnv, etc.) can't have `claude` typed in before `cd` actually
--      finished. Bounded so a genuinely stuck shell can't hang this open
--      forever.
on run argv
	set cdCommand to item 1 of argv
	set claudeCommand to item 2 of argv
	set wasRunning to application "Terminal" is running
	tell application "Terminal"
		activate
		if not wasRunning then delay 1
		set newTab to do script cdCommand
		set waited to 0
		repeat while busy of newTab and waited < 40
			delay 0.1
			set waited to waited + 1
		end repeat
		do script claudeCommand in newTab
	end tell
end run
