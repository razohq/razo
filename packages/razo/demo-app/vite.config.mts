import { defineConfig } from 'vite';
import { autoTestId } from '../src/tooling/autoTestId.js';

export default defineConfig({
  plugins: [autoTestId()],
});
