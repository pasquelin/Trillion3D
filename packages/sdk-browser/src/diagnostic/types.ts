/**
 * What an engine reports of itself when something goes wrong or when a view asks for detail:
 * the record the host collector queues, and how much of it a caller wants. Separate from the
 * engine contract of `../backend/types.ts` — this is what comes back out, not what is offered.
 */
export type DiagnosticDetail = 'summary' | 'trace';

/** One thing a renderer noticed, reported on a diagnostic channel. */
export type BackendDiagnostic = {
  /** The step it happened in. */
  phase: string;
  /** Words for a person to read. */
  message: string;
  /** Facts about it. */
  context: Record<string, unknown>;
  /** Added by the host collector; optional for standalone backend consumers. */
  sequence?: number;
  /** The session it came from. */
  sessionId?: string;
  /** When it was queued. */
  queuedAt?: number;
  /** When it was made. */
  createdAt?: number;
};
