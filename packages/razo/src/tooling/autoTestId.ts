/**
 * The other half of the framework: the stable hook. A component declares
 * who it is with `data-component="ExportButton"` and the plugin generates
 * `data-testid="export-button"` in dev/test — nobody maintains testids by hand.
 *
 * Alignment rule: the testid is the kebab-case of the component name.
 * Controls consume it as: `new Button(page, 'export-button', 'Export')`.
 */

export function toTestId(componentName: string): string {
  return componentName
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

/**
 * Injects data-testid into every tag that has data-component and no
 * manual data-testid (a manual one always wins).
 */
export function injectTestIds(html: string): string {
  return html.replace(/<[a-zA-Z][^>]*>/g, (tag) => {
    const component = tag.match(/\bdata-component="([^"]+)"/);
    if (!component || /\bdata-testid=/.test(tag)) return tag;
    const attribute = ` data-testid="${toTestId(component[1])}"`;
    return tag.endsWith('/>')
      ? `${tag.slice(0, -2).trimEnd()}${attribute} />`
      : `${tag.slice(0, -1)}${attribute}>`;
  });
}

/**
 * Structural subset of Vite's Plugin type — assignable to PluginOption at
 * the consumer's call site without making vite a hard dependency of razo.
 */
export interface AutoTestIdPlugin {
  name: string;
  transformIndexHtml: (html: string) => string;
}

/**
 * Vite plugin. Register it only in dev/test configs if you don't want
 * the attribute in production.
 */
export function autoTestId(): AutoTestIdPlugin {
  return {
    name: 'auto-testid',
    transformIndexHtml(html) {
      return injectTestIds(html);
    },
  };
}
