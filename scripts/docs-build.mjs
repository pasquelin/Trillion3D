/** Reproducible production styles and engine modules for the static learning portal. */
import { resolve } from 'node:path';
import { buildPortal } from './docs/build-portal.mjs';
import { buildRuntime } from './docs/build-runtime.mjs';
import { buildStyles } from './docs/build-styles.mjs';

const root = resolve(import.meta.dirname, '..');
await buildStyles(root);
await buildRuntime(root);

await buildPortal(root);
