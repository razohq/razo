# @razohq/razo

## 0.3.0

### Minor Changes

- bdefe20: Mask secrets typed into fields. When an `Input` is a password or one-time-code field (`type="password"`, or `autocomplete` `current-password`, `new-password`, `one-time-code`), what it types or asserts is narrated as `********` (exported as `MASKED`) in the sentence, `detail`, `expected` and `actual`, and removed from the error message: `Type "********" into field "Password"`. `fill`, `expectText` and `expectEmpty` take `sensitive: true` to mask any field, or `sensitive: false` to opt out. Playwright's own nested `Fill` step in the HTML report and traces still shows the value.

## 0.2.0

### Minor Changes

- Add TableRow control + Table row finders (row/rows) with row-scoped helpers, plus `... in <parent>` narration for
