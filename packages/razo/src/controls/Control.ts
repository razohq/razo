import { expect, test, type Locator, type Page } from '@playwright/test';
import { emitStepEvent, stripAnsi, type StepEvent } from '../reporting/events';

type StepEventExtras = Pick<StepEvent, 'healed' | 'domCandidates' | 'actual'>;

interface SentenceContext {
  controlType: string;
  name: string;
  detail?: string;
  expected?: string;
}

/**
 * Sentence grammar: one fixed template per verb, in a single place,
 * so the narration is predictable and parseable by an AI.
 */
const SENTENCES = {
  click: (c: SentenceContext) => `Click ${c.controlType} "${c.name}"`,
  fill: (c: SentenceContext) => `Type "${c.detail}" into ${c.controlType} "${c.name}"`,
  clear: (c: SentenceContext) => `Clear ${c.controlType} "${c.name}"`,
  select: (c: SentenceContext) => `Select option "${c.detail}" in ${c.controlType} "${c.name}"`,
  check: (c: SentenceContext) => `Check ${c.controlType} "${c.name}"`,
  uncheck: (c: SentenceContext) => `Uncheck ${c.controlType} "${c.name}"`,
  choose: (c: SentenceContext) => `Choose "${c.detail}" in ${c.controlType} "${c.name}"`,
  'choose-many': (c: SentenceContext) =>
    `Choose options "${c.detail}" in ${c.controlType} "${c.name}"`,
  open: (c: SentenceContext) => `Open ${c.controlType} "${c.name}"`,
  attach: (c: SentenceContext) => `Attach "${c.detail}" to ${c.controlType} "${c.name}"`,
  set: (c: SentenceContext) => `Set ${c.controlType} "${c.name}" to "${c.detail}"`,
  'assert-visible': (c: SentenceContext) => `Assert ${c.controlType} "${c.name}" is visible`,
  'assert-enabled': (c: SentenceContext) => `Assert ${c.controlType} "${c.name}" is enabled`,
  'assert-disabled': (c: SentenceContext) => `Assert ${c.controlType} "${c.name}" is disabled`,
  'assert-text': (c: SentenceContext) =>
    `Assert ${c.controlType} "${c.name}" has text "${c.expected}"`,
  'assert-checked': (c: SentenceContext) => `Assert ${c.controlType} "${c.name}" is checked`,
  'assert-unchecked': (c: SentenceContext) => `Assert ${c.controlType} "${c.name}" is not checked`,
  'assert-selected': (c: SentenceContext) =>
    `Assert ${c.controlType} "${c.name}" has option "${c.expected}" selected`,
  'assert-value': (c: SentenceContext) =>
    `Assert ${c.controlType} "${c.name}" has value "${c.expected}"`,
  'assert-href': (c: SentenceContext) =>
    `Assert ${c.controlType} "${c.name}" points to "${c.expected}"`,
  // Universal interactions
  hover: (c: SentenceContext) => `Hover over ${c.controlType} "${c.name}"`,
  'double-click': (c: SentenceContext) => `Double-click ${c.controlType} "${c.name}"`,
  'right-click': (c: SentenceContext) => `Right-click ${c.controlType} "${c.name}"`,
  press: (c: SentenceContext) => `Press "${c.detail}" on ${c.controlType} "${c.name}"`,
  focus: (c: SentenceContext) => `Focus ${c.controlType} "${c.name}"`,
  'scroll-to': (c: SentenceContext) => `Scroll to ${c.controlType} "${c.name}"`,
  // detail carries the drop target already rendered as `type "name"`
  drag: (c: SentenceContext) => `Drag ${c.controlType} "${c.name}" onto ${c.detail}`,
  // Universal assertions
  'assert-hidden': (c: SentenceContext) => `Assert ${c.controlType} "${c.name}" is hidden`,
  'assert-focused': (c: SentenceContext) => `Assert ${c.controlType} "${c.name}" is focused`,
  'assert-contains-text': (c: SentenceContext) =>
    `Assert ${c.controlType} "${c.name}" contains text "${c.expected}"`,
  'assert-attribute': (c: SentenceContext) =>
    `Assert ${c.controlType} "${c.name}" attribute "${c.detail}" is "${c.expected}"`,
  'assert-empty': (c: SentenceContext) => `Assert ${c.controlType} "${c.name}" is empty`,
  // Switch
  'turn-on': (c: SentenceContext) => `Turn on ${c.controlType} "${c.name}"`,
  'turn-off': (c: SentenceContext) => `Turn off ${c.controlType} "${c.name}"`,
  'assert-on': (c: SentenceContext) => `Assert ${c.controlType} "${c.name}" is on`,
  'assert-off': (c: SentenceContext) => `Assert ${c.controlType} "${c.name}" is off`,
  // Combobox
  pick: (c: SentenceContext) => `Pick "${c.detail}" in ${c.controlType} "${c.name}"`,
  // Table
  'assert-row-count': (c: SentenceContext) =>
    `Assert ${c.controlType} "${c.name}" has ${c.expected} rows`,
  'assert-row-contains': (c: SentenceContext) =>
    `Assert ${c.controlType} "${c.name}" has a row containing "${c.expected}"`,
  // Dialog
  close: (c: SentenceContext) => `Close ${c.controlType} "${c.name}"`,
  'assert-open': (c: SentenceContext) => `Assert ${c.controlType} "${c.name}" is open`,
  'assert-closed': (c: SentenceContext) => `Assert ${c.controlType} "${c.name}" is closed`,
  // Tabs
  'open-tab': (c: SentenceContext) => `Open tab "${c.detail}" in ${c.controlType} "${c.name}"`,
  'assert-active-tab': (c: SentenceContext) =>
    `Assert ${c.controlType} "${c.name}" has active tab "${c.expected}"`,
  // Image
  'assert-alt': (c: SentenceContext) =>
    `Assert ${c.controlType} "${c.name}" has alt text "${c.expected}"`,
  'assert-loaded': (c: SentenceContext) => `Assert ${c.controlType} "${c.name}" is loaded`,
  // DatePicker
  'pick-date': (c: SentenceContext) =>
    `Pick date "${c.detail}" in ${c.controlType} "${c.name}"`,
  // Collections
  'assert-count': (c: SentenceContext) =>
    `Assert ${c.controlType} "${c.name}" appears ${c.expected} times`,
  // Tooltip
  'assert-tooltip': (c: SentenceContext) =>
    `Assert ${c.controlType} "${c.name}" says "${c.expected}"`,
} as const;

export type StepAction = keyof typeof SENTENCES;

export interface StepOptions {
  /** Action payload (typed text, chosen option) */
  detail?: string;
  /** Assertions only: expected value */
  expected?: string;
  /** On assertion failure: how to read the value actually found */
  readActual?: () => Promise<string>;
  /** Sentence override for business-level narration ("Confirm the export") */
  as?: string;
}

export interface ControlOptions {
  /** Scope the control inside another one (e.g. a button within a dialog). */
  within?: Control;
  /**
   * Deterministic healing alternatives, tried in order when the primary
   * locator stops resolving. After these, the implicit `role + name`
   * fallback derived from the control type is tried. See RAZO_HEALING.
   */
  fallbacks?: LocatorSpec[];
}

type AriaRole = Parameters<Page['getByRole']>[0];

/**
 * Safe role per control type for the implicit healing fallback. Types whose
 * role is ambiguous (label, tooltip, editor, file input…) are deliberately
 * absent: they only heal through explicit `fallbacks`.
 */
// Keys are the exact controlType strings the subclasses declare.
const IMPLICIT_ROLE: Record<string, AriaRole> = {
  button: 'button',
  link: 'link',
  checkbox: 'checkbox',
  'radio group': 'radiogroup',
  switch: 'switch',
  field: 'textbox',
  'text area': 'textbox',
  // Single-choice <select>; a `multiple` select is a listbox and will simply
  // not match the count()===1 guard — it fails safe instead of mis-healing.
  select: 'combobox',
  combobox: 'combobox',
  slider: 'slider',
  dialog: 'dialog',
  menu: 'menu',
  tabs: 'tablist',
  image: 'img',
  table: 'table',
};

type HealingMode = 'pass' | 'fail' | 'off';

/** RAZO_HEALING: pass (default: heal and warn) | fail (heal only to diagnose) | off. */
function healingMode(): HealingMode {
  const value = process.env.RAZO_HEALING;
  return value === 'fail' || value === 'off' ? value : 'pass';
}

/**
 * How to find a control. A plain string means data-testid (the recommended,
 * stable path — see the auto-testid Vite plugin); the object forms map 1:1
 * to Playwright's user-facing locators, so razo works on apps that were
 * never instrumented. `{ locator }` is the full escape hatch.
 */
export type LocatorSpec =
  | string
  | { testId: string }
  | { role: AriaRole; name?: string; exact?: boolean }
  | { label: string; exact?: boolean }
  | { placeholder: string }
  | { text: string; exact?: boolean }
  | { altText: string }
  | { title: string }
  | { css: string }
  | { locator: Locator };

function resolveLocator(root: Page | Locator, spec: LocatorSpec): Locator {
  if (typeof spec === 'string') return root.getByTestId(spec);
  if ('testId' in spec) return root.getByTestId(spec.testId);
  if ('role' in spec) return root.getByRole(spec.role, { name: spec.name, exact: spec.exact });
  if ('label' in spec) return root.getByLabel(spec.label, { exact: spec.exact });
  if ('placeholder' in spec) return root.getByPlaceholder(spec.placeholder);
  if ('text' in spec) return root.getByText(spec.text, { exact: spec.exact });
  if ('altText' in spec) return root.getByAltText(spec.altText);
  if ('title' in spec) return root.getByTitle(spec.title);
  if ('css' in spec) return root.locator(spec.css);
  return spec.locator;
}

/** Human/AI-readable selector string for the StepEvent. */
function describeSelector(spec: LocatorSpec): string {
  if (typeof spec === 'string') return `[data-testid="${spec}"]`;
  if ('testId' in spec) return `[data-testid="${spec.testId}"]`;
  if ('role' in spec) return spec.name ? `role=${spec.role}[name="${spec.name}"]` : `role=${spec.role}`;
  if ('label' in spec) return `label="${spec.label}"`;
  if ('placeholder' in spec) return `placeholder="${spec.placeholder}"`;
  if ('text' in spec) return `text="${spec.text}"`;
  if ('altText' in spec) return `alt="${spec.altText}"`;
  if ('title' in spec) return `title="${spec.title}"`;
  if ('css' in spec) return `css=${spec.css}`;
  return String(spec.locator);
}

export abstract class Control {
  protected abstract readonly controlType: string;
  /** @deprecated Only set when the control was located by testid; use `selector`. */
  readonly testId: string;

  // Mutable internals so deterministic healing can re-point the control; the
  // public surface stays read-only.
  private _locator: Locator;
  private _selector: string;
  private readonly parent?: Control;
  private readonly fallbacks: LocatorSpec[];

  /**
   * Root that fallbacks resolve against — read lazily so a child control
   * follows its `within` parent even after the PARENT healed.
   */
  private get healRoot(): Page | Locator {
    return this.parent?.locator ?? this.page;
  }

  private get withinPrefix(): string {
    return this.parent ? `${this.parent.selector} ` : '';
  }

  /** The Playwright locator currently backing this control. */
  get locator(): Locator {
    return this._locator;
  }

  /** Readable selector, chained through `within` parents; travels in every StepEvent. */
  get selector(): string {
    return this._selector;
  }

  constructor(
    readonly page: Page,
    locate: LocatorSpec,
    readonly name: string,
    options: ControlOptions = {},
  ) {
    if (!name || !name.trim()) {
      throw new Error(
        `Control located by ${describeSelector(locate)} needs a human-readable name: an anonymous control breaks the narration.`,
      );
    }
    this.testId =
      typeof locate === 'string' ? locate : 'testId' in locate ? locate.testId : '';
    // A raw { locator } escape hatch is already bound to the page, so it
    // cannot be re-rooted inside a `within` parent.
    this.parent = options.within;
    this.fallbacks = options.fallbacks ?? [];
    this._locator = resolveLocator(this.healRoot, locate);
    this._selector = this.withinPrefix + describeSelector(locate);
  }

  /**
   * Core of the framework: runs `fn` inside a test.step titled with the
   * grammar sentence, and emits the matching structured StepEvent —
   * also (especially) when it fails.
   */
  protected async step<T>(
    action: StepAction,
    options: StepOptions,
    fn: () => Promise<T>,
  ): Promise<T> {
    const context: SentenceContext = {
      controlType: this.controlType,
      name: this.name,
      detail: options.detail,
      expected: options.expected,
    };
    const baseSentence = SENTENCES[action](context);
    const scoped = this.parent
      ? `${baseSentence} in ${this.parent.controlType} "${this.parent.name}"`
      : baseSentence;
    const sentence = options.as ?? scoped;
    const base = {
      action,
      controlType: this.controlType,
      name: this.name,
      sentence,
      detail: options.detail,
      expected: options.expected,
    };
    const fail = (error: unknown, extra: Partial<StepEventExtras> = {}) => {
      emitStepEvent({
        ...base,
        ...extra,
        selector: this.selector,
        status: 'failed',
        error: stripAnsi(error instanceof Error ? error.message : String(error)),
        timestamp: new Date().toISOString(),
      });
    };
    return test.step(sentence, async () => {
      try {
        const result = await fn();
        emitStepEvent({
          ...base, selector: this.selector, status: 'passed', timestamp: new Date().toISOString(),
        });
        return result;
      } catch (error) {
        // Deterministic healing: only when the primary locator resolves to
        // NOTHING. An element that exists but fails the action/assertion is
        // a real failure — healing must never mask a regression.
        const gone = healingMode() !== 'off' && (await this.primaryGone());
        if (gone) {
          const healedSpec = await this.findHealingSpec();
          if (healedSpec) {
            const healed = {
              from: this.selector,
              to: this.withinPrefix + describeSelector(healedSpec),
            };
            this._locator = resolveLocator(this.healRoot, healedSpec);
            this._selector = healed.to;
            if (healingMode() === 'fail') {
              const drift = new Error(
                `locator drift: ${healed.from} no longer resolves; element found via ${healed.to} — update the locator`,
              );
              fail(drift, { healed });
              throw drift;
            }
            try {
              const result = await fn();
              emitStepEvent({
                ...base, selector: this.selector, healed, status: 'passed',
                timestamp: new Date().toISOString(),
              });
              return result;
            } catch (retryError) {
              const actual = options.readActual
                ? await options.readActual().catch(() => undefined)
                : undefined;
              fail(retryError, { healed, actual });
              throw retryError;
            }
          }
        }
        const actual = options.readActual
          ? await options.readActual().catch(() => undefined)
          : undefined;
        const domCandidates = gone ? await this.collectDomCandidates() : undefined;
        fail(error, { actual, domCandidates });
        throw error;
      }
    });
  }

  /** True when the primary locator currently matches nothing (safe: never throws). */
  private async primaryGone(): Promise<boolean> {
    try {
      return (await this._locator.count()) === 0;
    } catch {
      return false;
    }
  }

  /** First fallback (explicit, then implicit role+name) resolving to exactly one element. */
  private async findHealingSpec(): Promise<LocatorSpec | null> {
    const role = IMPLICIT_ROLE[this.controlType];
    const candidates: LocatorSpec[] = [
      ...this.fallbacks,
      // exact: getByRole's name matching is substring by default, which on a
      // page with "Export" and "Confirm export…" would match both and block
      // (or worse, mis-target) the heal. Exact accessible name only.
      ...(role ? [{ role, name: this.name, exact: true } as LocatorSpec] : []),
    ];
    for (const spec of candidates) {
      try {
        if ((await resolveLocator(this.healRoot, spec).count()) === 1) return spec;
      } catch {
        // Unresolvable fallback spec: try the next one.
      }
    }
    return null;
  }

  /**
   * Same-role elements on the page, as evidence for the analyzer to propose
   * a replacement locator. Best-effort: capped, time-boxed, never throws.
   */
  private async collectDomCandidates(): Promise<string[] | undefined> {
    const role = IMPLICIT_ROLE[this.controlType];
    if (!role) return undefined;
    const collect = async () => {
      const elements = (await this.healRoot.getByRole(role).all()).slice(0, 5);
      const out: string[] = [];
      for (const element of elements) {
        const label =
          (await element.getAttribute('aria-label')) ?? (await element.textContent()) ?? '';
        out.push(`role=${role} name="${label.trim().replace(/\s+/g, ' ').slice(0, 120)}"`);
      }
      return out.length > 0 ? out : undefined;
    };
    const timeBox = new Promise<undefined>((resolve) => {
      setTimeout(() => resolve(undefined), 2_000).unref?.();
    });
    try {
      // collect() carries its own catch: if it loses the race and rejects
      // later (page closed mid-read), the rejection must not go unhandled.
      return await Promise.race([collect().catch(() => undefined), timeBox]);
    } catch {
      return undefined;
    }
  }

  async expectVisible(options: Pick<StepOptions, 'as'> = {}) {
    await this.step(
      'assert-visible',
      {
        ...options,
        expected: 'visible',
        readActual: async () => ((await this.locator.isVisible()) ? 'visible' : 'hidden'),
      },
      () => expect(this.locator).toBeVisible(),
    );
  }

  async expectEnabled(options: Pick<StepOptions, 'as'> = {}) {
    await this.step(
      'assert-enabled',
      {
        ...options,
        expected: 'enabled',
        readActual: async () => ((await this.locator.isEnabled()) ? 'enabled' : 'disabled'),
      },
      () => expect(this.locator).toBeEnabled(),
    );
  }

  async expectDisabled(options: Pick<StepOptions, 'as'> = {}) {
    await this.step(
      'assert-disabled',
      {
        ...options,
        expected: 'disabled',
        readActual: async () => ((await this.locator.isEnabled()) ? 'enabled' : 'disabled'),
      },
      () => expect(this.locator).toBeDisabled(),
    );
  }

  async expectText(expected: string, options: Pick<StepOptions, 'as'> = {}) {
    await this.step(
      'assert-text',
      {
        ...options,
        expected,
        readActual: async () => ((await this.locator.textContent()) ?? '').trim(),
      },
      () => expect(this.locator).toHaveText(expected),
    );
  }

  /** The control as it appears in the narration: `button "Export"`. */
  describe(): string {
    return `${this.controlType} "${this.name}"`;
  }

  // --- universal interactions ---

  async hover(options: Pick<StepOptions, 'as'> = {}) {
    await this.step('hover', options, () => this.locator.hover());
  }

  async doubleClick(options: Pick<StepOptions, 'as'> = {}) {
    await this.step('double-click', options, () => this.locator.dblclick());
  }

  async rightClick(options: Pick<StepOptions, 'as'> = {}) {
    await this.step('right-click', options, () => this.locator.click({ button: 'right' }));
  }

  async press(key: string, options: Pick<StepOptions, 'as'> = {}) {
    await this.step('press', { ...options, detail: key }, () => this.locator.press(key));
  }

  async focus(options: Pick<StepOptions, 'as'> = {}) {
    await this.step('focus', options, () => this.locator.focus());
  }

  async scrollTo(options: Pick<StepOptions, 'as'> = {}) {
    await this.step('scroll-to', options, () => this.locator.scrollIntoViewIfNeeded());
  }

  async dragTo(target: Control, options: Pick<StepOptions, 'as'> = {}) {
    await this.step('drag', { ...options, detail: target.describe() }, () =>
      this.locator.dragTo(target.locator),
    );
  }

  // --- universal assertions ---

  async expectHidden(options: Pick<StepOptions, 'as'> = {}) {
    await this.step(
      'assert-hidden',
      {
        ...options,
        expected: 'hidden',
        readActual: async () => ((await this.locator.isVisible()) ? 'visible' : 'hidden'),
      },
      () => expect(this.locator).toBeHidden(),
    );
  }

  async expectFocused(options: Pick<StepOptions, 'as'> = {}) {
    await this.step(
      'assert-focused',
      {
        ...options,
        expected: 'focused',
        readActual: () =>
          this.locator.evaluate((el) =>
            el === el.ownerDocument.activeElement ? 'focused' : 'not focused',
          ),
      },
      () => expect(this.locator).toBeFocused(),
    );
  }

  async expectContainsText(expected: string, options: Pick<StepOptions, 'as'> = {}) {
    await this.step(
      'assert-contains-text',
      {
        ...options,
        expected,
        readActual: async () => ((await this.locator.textContent()) ?? '').trim(),
      },
      () => expect(this.locator).toContainText(expected),
    );
  }

  async expectAttribute(
    attribute: string,
    expected: string,
    options: Pick<StepOptions, 'as'> = {},
  ) {
    await this.step(
      'assert-attribute',
      {
        ...options,
        detail: attribute,
        expected,
        readActual: async () => (await this.locator.getAttribute(attribute)) ?? 'none',
      },
      () => expect(this.locator).toHaveAttribute(attribute, expected),
    );
  }

  /** For repeated testids (list items): how many elements the control matches. */
  async expectCount(expected: number, options: Pick<StepOptions, 'as'> = {}) {
    await this.step(
      'assert-count',
      {
        ...options,
        expected: String(expected),
        readActual: async () => String(await this.locator.count()),
      },
      () => expect(this.locator).toHaveCount(expected),
    );
  }
}
