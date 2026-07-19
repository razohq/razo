/**
 * Vite plugin entry point: `import { autoTestId } from '@razohq/razo/vite'`.
 * Kept separate from the main entry so consumers who don't use Vite
 * never touch it (vite is an optional peer dependency).
 */
export { autoTestId, injectTestIds, toTestId, type AutoTestIdPlugin } from './tooling/autoTestId';
