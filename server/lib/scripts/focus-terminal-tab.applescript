-- Focus + visually flash the Terminal.app tab whose tty matches the given
-- device path (e.g. "/dev/ttys003"). Invoked as:
--   osascript focus-terminal-tab.applescript <tty>
-- The tty is passed as an argv element (never interpolated into the script
-- source) so nothing here is a shell/AppleScript-injection surface.
-- Prints exactly "found" or "not-found" to stdout.
on run argv
	set targetTTY to item 1 of argv
	tell application "Terminal"
		activate
		repeat with w in windows
			repeat with t in tabs of w
				try
					if tty of t is targetTTY then
						set selected tab of w to t
						set frontmost of w to true
						set savedColor to background color of t
						repeat 3 times
							set background color of t to {52224, 0, 0}
							delay 0.15
							set background color of t to savedColor
							delay 0.15
						end repeat
						return "found"
					end if
				end try
			end repeat
		end repeat
	end tell
	return "not-found"
end run
