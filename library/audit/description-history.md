# Description History — Per-Entry Description Versions

> Append-only. Used for oscillation/thrashing detection: before proposing a
> description change, the analyst diffs the candidate against this list. If it
> equals a prior version, that is flagged as THRASHING rather than silently
> re-flipped.

<!-- Append a section per entry as descriptions change, e.g.:

### kb-<domain>-<topic-slug>
- <YYYY-MM-DD> v1: "<description text>"
- <YYYY-MM-DD> v2: "<description text>"

-->
