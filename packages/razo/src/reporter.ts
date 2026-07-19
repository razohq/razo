/**
 * Reporter entry point. Playwright instantiates the module's default export
 * when the reporter is referenced by string: `reporter: [['@razohq/razo/reporter']]`.
 */
export { default } from './reporting/AiReporter';
export type { AiReporterOptions, AiTestReport } from './reporting/AiReporter';
export { AI_STEP_ATTACHMENT, type StepEvent } from './reporting/events';
