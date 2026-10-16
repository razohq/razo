---
'@razohq/razo': patch
---

A masked `fill` no longer leaks the value through Playwright's own nested step. Playwright titles its fill `Fill "<value>"` in the HTML report, so for a sensitive field razo now runs `fill('')` (keeping the waiting, focus and clearing) and sets the value with the native setter plus `input` and `change` events, which reads as `Fill ""` and `Evaluate`. Ordinary fields still use Playwright's fill. Traces still record call arguments.
