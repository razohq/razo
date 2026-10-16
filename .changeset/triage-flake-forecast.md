---
'@razohq/triage': minor
---

Flake forecast. The report gets an `atRisk` list: tests that passed on their first attempt in the latest base-branch run but whose recent history there keeps flipping, retrying, or getting slower and more erratic. Each comes with a risk from 0 to 1 and its reasons. It is advisory: it proposes no action and never changes a verdict. A flip across a commit counts `crossShaFlipWeight` (0.25) of one on the same commit, so a break and its revert do not read as flakiness. Thresholds live under `rules.forecast` (`maxTests: 0` turns it off). The Markdown report gains an "At risk" section, the CLI prints one line per test at risk, and the `http` notifier caps the list at 50. `atRisk` is optional in the delivery contract; a destination may ignore it. Adapted from playwright-smart-reporter (MIT).
