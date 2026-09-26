# Fixtures

Real `razo-steps.json` artifacts in the `razo-source` layout
(`<scenario>/runs/<runId>/{run.json,reports/**}`), used by the tests of
`cluster`, `history`, `suspects` and `classify`. Regenerate them with the
scripts in `../scripts`; never edit a report by hand.

| Scenario | Origin | Synthetic? |
|---|---|---|
| `razo-suite` | One run of `packages/razo`'s own Playwright suite: 45 tests, 1 deliberate failure, healed steps and DOM candidates. | No |
| `cloud-examples` | The three example projects of razo-cloud (button hidden, table count, row action), one run each. The sha is all zeros: the examples have no git history of their own. | No |
| `razo-demo-pr-1` | Public repo razohq/razo-demo, PR #1: a green run at the base commit and a red run at the PR head, plus `commits.json` with the real diffs. | No |
| `synthetic-flaky` | `generator/`, `retries: 2`, one test that fails only on its first attempt. Real reporter, scripted behaviour. | Yes |
| `synthetic-environment` | `generator/` against a closed port: every spec fails with a connection error. Real reporter, scripted behaviour. | Yes |

Synthetic scenarios carry `"synthetic": true` in every `run.json`;
`fixtures.test.mjs` checks the flag matches the directory name.

Anonymization is not needed for any of these: they come from repos we own
or that are public. `../scripts/anonymize-fixture.mjs` exists for the day
a third-party project's data is captured. It rewrites report contents,
not directory names: re-run `capture-run.mjs` on the anonymized reports
if the slugs matter.
