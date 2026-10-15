---
"@razohq/triage": minor
---

First public release of the morning triage: `npx triage pull` and `npx triage run` cluster a Playwright suite's CI failures by cause, classify each cluster (regression, flaky, environment, stale test, unknown), name the suspect commits, keep state between mornings, and deliver the report as Markdown or to an HTTP endpoint. A read-only GitHub tracker links failures to their issues. The contract test kits ship as `@razohq/triage/contract`, the in-memory fakes as `@razohq/triage/fakes`.
