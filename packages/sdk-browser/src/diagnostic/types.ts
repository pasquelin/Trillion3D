/**
 * What an engine reports of itself when something goes wrong or when a view asks for detail:
 * the record the host collector queues, and how much of it a caller wants. Separate from the
 * engine contract of `../backend/types.ts` — this is what comes back out, not what is offered.
 */
export type DiagnosticDetail = 'summary' | 'trace';

export type BackendDiagnostic = {
  phase: string;
  message: string;
  context: Record<string, unknown>;
  /** Added by the host collector; optional for standalone backend consumers. */
  sequence?: number;
  sessionId?: string;
  queuedAt?: number;
  createdAt?: number;
};
