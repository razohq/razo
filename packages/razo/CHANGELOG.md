# @razohq/razo

## 0.3.1

### Patch Changes

- 7816a79: A masked `fill` no longer leaks the value through Playwright's own nested step. Playwright titles its fill `Fill "<value>"` in the HTML report, so for a sensitive field razo now runs `fill('')` (keeping the waiting, focus and clearing) and sets the value with the native setter plus `input` and `change` events, which reads as `Fill ""` and `Evaluate`. Ordinary fields still use Playwright's fill. Traces still record call arguments.

## 0.3.0

### Minor Changes

- bdefe20: Mask secrets typed into fields. When an `Input` is a password or one-time-code field (`type="password"`, or `autocomplete` `current-password`, `new-password`, `one-time-code`), what it types or asserts is narrated as `********` (exported as `MASKED`) in the sentence, `detail`, `expected` and `actual`, and removed from the error message: `Type "********" into field "Password"`. `fill`, `expectText` and `expectEmpty` take `sensitive: true` to mask any field, or `sensitive: false` to opt out. Playwright's own nested `Fill` step in the HTML report and traces still shows the value.

## 0.2.0

### Minor Changes

- Add TableRow control + Table row finders (row/rows) with row-scoped helpers, plus `... in <parent>` narration for
