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
						-- Read the restore target from the tab's *settings set*
						-- (its profile), not from `background color of t` itself.
						-- The latter is a snapshot of live, mutable tab state - if
						-- an earlier run of this same script got interrupted or
						-- raced with another one, that snapshot could already be
						-- the stuck flash color, and "restoring" to it would just
						-- re-lock the tab onto red forever. The settings-set color
						-- is the tab's actual default and is untouched by the
						-- flash below, so every run self-heals regardless of what
						-- state the tab was left in previously.
						set defaultColor to background color of (current settings of t)
						repeat 3 times
							set background color of t to {52224, 0, 0}
							delay 0.15
							set background color of t to defaultColor
							delay 0.15
						end repeat
						-- Terminal's Apple Event handling can occasionally drop or
						-- misapply a rapid property-set, leaving the tab one
						-- flash-color write "ahead" of where this script thinks it
						-- left things. Verify the restore actually stuck and
						-- re-apply it if not, rather than trusting the last write
						-- in the loop above blindly.
						repeat 6 times
							if background color of t is defaultColor then exit repeat
							set background color of t to defaultColor
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
