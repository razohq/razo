---
'@razohq/razo': minor
'@razohq/razo-analyzer': minor
---

Page signals. razo records what the page did that no step asked for: console errors, uncaught exceptions, failed requests and 5xx answers, live from page events (no trace needed). `razo-steps.json` gains `signals`, each with the `afterStep` it followed, and, for a failed test, `firstAnomaly`: the first signal before the failure. Listening starts the first time a control touches a page; `observePage(page)` catches the initial load. Cancelled requests, Chromium's `Failed to load resource` echo and 4xx answers are left out; a test keeps at most 50.

The analyzer lists the signals in the prompt and marks the first anomaly, the system prompt explains what a 5xx or an uncaught exception before a failure means, the redactor masks secrets in signal URLs and texts, and `razo-upload` caps signals at 50 per report.
