import type { BackendFactory } from './backendTypes.ts';
import { referenceBackend } from './referenceBackend.ts';
import { exactPagesBackend } from './exactPagesBackend.ts';
import { threeLodBackend } from './threeLod.ts';

export const DEFAULT_BACKENDS: BackendFactory[] = [
  referenceBackend,
  exactPagesBackend,
  threeLodBackend,
];
