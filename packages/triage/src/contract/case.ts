/**
 * A contract case is runner-agnostic: it asserts with node:assert and is
 * handed to whatever `test` function the plugin's own suite uses.
 */
export interface ContractCase {
  name: string;
  run(): Promise<void>;
}

export type TestFn = (name: string, fn: () => Promise<void>) => unknown;

/** Registers every case with the given test function (node:test, vitest, jest…). */
export function runContract(cases: ContractCase[], test: TestFn): void {
  for (const c of cases) test(c.name, c.run);
}
