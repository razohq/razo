import * as fs from 'fs';
import * as path from 'path';
import { test, expect } from '@playwright/test';
import { injectTestIds, toTestId } from '../src/tooling/autoTestId';
import { Button, Checkbox, Input, Label, AI_STEP_ATTACHMENT, type StepEvent } from '../src';

test('component names map to predictable testids', () => {
  expect(toTestId('SaveButton')).toBe('save-button');
  expect(toTestId('NewsletterOptIn')).toBe('newsletter-opt-in');
  expect(toTestId('APIKey2Field')).toBe('apikey2-field');
});

test('a manual data-testid always wins over the generated one', () => {
  const html = injectTestIds('<p data-component="StatusMessage" data-testid="legacy-status"></p>');
  expect(html).toBe('<p data-component="StatusMessage" data-testid="legacy-status"></p>');
});

test('a component without manual testid is reachable by the framework', async ({ page }, testInfo) => {
  // Same transformation the Vite plugin applies (transformIndexHtml).
  const source = fs.readFileSync(path.resolve(__dirname, '../demo-app/index.html'), 'utf8');
  const transformed = injectTestIds(source);
  const built = testInfo.outputPath('auto.html');
  fs.writeFileSync(built, transformed);
  await page.goto('file://' + built);

  // Testids come from the component name: NicknameField → nickname-field.
  const nickname = new Input(page, toTestId('NicknameField'), 'Nickname');
  const newsletter = new Checkbox(page, toTestId('NewsletterOptIn'), 'Newsletter opt-in');
  const save = new Button(page, toTestId('SaveButton'), 'Save');
  const status = new Label(page, 'legacy-status', 'Status message');

  await nickname.fill('expermicid');
  await newsletter.check();
  await save.click();
  await status.expectText('Saved profile for expermicid');

  const sentences = test
    .info()
    .attachments.filter((a) => a.name === AI_STEP_ATTACHMENT)
    .map((a) => (JSON.parse(a.body!.toString()) as StepEvent).sentence);
  expect(sentences).toEqual([
    'Type "expermicid" into field "Nickname"',
    'Check checkbox "Newsletter opt-in"',
    'Click button "Save"',
    'Assert label "Status message" has text "Saved profile for expermicid"',
  ]);
});
