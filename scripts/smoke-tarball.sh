#!/usr/bin/env bash
# Packs razo and consumes the tarball from a fresh project, exercising the
# public entry points ('razo', '@razohq/razo/reporter') exactly like a real user.
# This is the only check that catches CJS default-export interop regressions
# in the reporter.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

# Pin the consumer's Playwright to the repo's version so the browser CI already
# installed (and cached) matches — an unpinned install can resolve a newer
# Playwright whose browser build was never downloaded.
PW_VERSION="$(node -p "require('$ROOT/node_modules/@playwright/test/package.json').version")"

cd "$ROOT/packages/razo"
npm run build > /dev/null
TARBALL="$(npm pack --pack-destination "$WORKDIR" | tail -1)"

cd "$WORKDIR"
npm init -y > /dev/null
npm install --no-audit --no-fund -D "./$TARBALL" "@playwright/test@$PW_VERSION" typescript @types/node > /dev/null

# Ensure the matching browser is present (no-op when already cached).
npx playwright install chromium > /dev/null

cat > playwright.config.ts <<'EOF'
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  reporter: [['list'], ['@razohq/razo/reporter']],
});
EOF

mkdir tests
cat > tests/consume.spec.ts <<'EOF'
import { test, expect } from '@playwright/test';
import { Button, Label } from '@razohq/razo';

test('packaged razo narrates a click and an assertion', async ({ page }) => {
  await page.setContent(`
    <button data-testid="save"
      onclick="document.querySelector('[data-testid=msg]').textContent='saved'">Save</button>
    <p data-testid="msg"></p>
  `);
  const save = new Button(page, 'save', 'Save');
  const message = new Label(page, 'msg', 'Message');
  await save.click();
  await message.expectText('saved');
});
EOF

npx playwright test

# ESM entry resolves too
node --input-type=module -e "import('@razohq/razo').then(m => { if (!m.Button) throw new Error('ESM import broken'); })"

REPORT="$(find test-results -name razo-steps.json | head -1)"
[ -n "$REPORT" ] || { echo 'FAIL: razo-steps.json was not written'; exit 1; }
node -e "
const report = JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'));
const sentences = report.steps.map((s) => s.sentence);
const expected = ['Click button \"Save\"', 'Assert label \"Message\" has text \"saved\"'];
for (const sentence of expected) {
  if (!sentences.includes(sentence)) {
    console.error('FAIL: missing narration:', sentence, '— got:', sentences);
    process.exit(1);
  }
}
" "$REPORT"

echo "SMOKE OK: $REPORT"
cat "$REPORT"
