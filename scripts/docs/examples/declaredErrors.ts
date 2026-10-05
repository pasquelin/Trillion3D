/**
 * The errors an example page may raise or log, each named with its page and why; every other one
 * fails the proofs (#945): the engine's own failures (`worldHandles.ts`, `interactive.ts`,
 * `webgpu/pages/io/lost.ts`), a module whose import fails, a resource answered 404.
 */
const DECLARED_ERRORS: readonly { page: string; error: string; why: string }[] = [
  {
    page: 'outline-the-selection',
    error: 'effect.outline is not a function',
    why: 'parked, written against the outline pass #757 delivers',
  },
];

/** Whether `error`, raised or logged by the example `page`, is one declared for it. */
export const declaredError = (page: string, error: string) =>
  DECLARED_ERRORS.some((declared) => declared.page === page && declared.error === error);
