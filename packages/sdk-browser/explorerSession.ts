import { DEFAULT_SCOPE } from '../sdk-core/index.ts';
import type { RuntimeEvent } from '../sdk-core/index.ts';
import type { ExplorerOptions } from './backendTypes.ts';
import { createDiagnosticChannel } from './diagnosticChannel.ts';

export function createExplorerSession(options: ExplorerOptions) {
  const diagnosticChannel = createDiagnosticChannel(options.onDiagnostic, {
    detail: options.diagnosticDetail ?? (options.onDiagnostic ? 'trace' : 'summary'),
  });
  const emit = (event: RuntimeEvent) => {
    try {
      options.onEvent?.(event);
    } catch {
      /* Diagnostic observers cannot interrupt rendering. */
    }
  };
  const diagnose = (phase: string, message: string, context: Record<string, unknown> = {}) =>
    diagnosticChannel.emit({ phase, message, context });
  const preparationStart = performance.now();
  const signal = options.signal;
  const scope = options.scope ?? DEFAULT_SCOPE;
  const progress = (phase: string, completed: number, total: number, message: string) => {
    signal?.throwIfAborted();
    options.onPreparation?.({ phase, completed, total, message });
    diagnose('preparation', message, { kind: 'preparation', phase, completed, total, scope });
  };
  return { diagnosticChannel, emit, diagnose, preparationStart, signal, scope, progress };
}
