# razo-demo nightlies

Real runs of https://github.com/razohq/razo-demo on `main`, 2026-09-26 to
2026-10-09: the scheduled nightlies plus the push runs of
each merge, as `triage pull` downloaded them (21 runs), regenerated with
`scripts/capture-razo-demo-nightlies.mjs`. `commits.json` lists every
commit from the first run's sha to the last one, merges included with
their first-parent diff and their parents.

The calibration broke main three times on purpose and reverted it each
time (razo-demo PRs #3/#4, #5/#6, #8/#9): hiding Place order (stale-test)
and changing the SAVE10 amount (regression). So the history holds three
red streaks, each closed by green runs, and the last one opens and closes
inside a single 24-hour window. Not synthetic.
