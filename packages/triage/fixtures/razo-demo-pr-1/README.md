# razo-demo PR #1

Real runs of https://github.com/razohq/razo-demo at the base commit (bea5183, green) and at the head of
pull request #1 (80a6543, red), regenerated with `scripts/capture-razo-demo.mjs`.
Both are recorded on branch `main`: the PR head is what main would have
become the night after merging, which is the situation the triage models;
`prNumber` keeps the provenance. `commits.json` lists the base commit followed by the 3
non-merge commits up to the head in git's topological order (author dates are
not monotonic: the PR commit predates the merge-base commit), with their diffs
and VCS status. The PR hides
the Place order button and removes the Mouse row, so two tests fail; the
expected verdict for the Place order test is stale-test with medium
confidence. Not synthetic.
