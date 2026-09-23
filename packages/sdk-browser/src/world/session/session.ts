import { DEFAULT_SCOPE, setScreenErrorVariant } from '../../../../sdk-core/src/index.ts';
import type { AssetScope, ClusterManifest, RuntimeEvent } from '../../../../sdk-core/src/index.ts';
import type { MeasuredWorldOptions } from '../../backend/types.ts';
import { createDiagnosticChannel } from '../../diagnostic/channel.ts';
import { watchOpening } from './openWatch.ts';

/** The two observer outlets every explorer module reports through. */
export type ExplorerEmitters = {
  emit: (event: RuntimeEvent) => void;
  diagnose: (phase: string, message: string, context?: Record<string, unknown>) => void;
};

/** What one explorer shares from its manifest onwards; built once and handed to each module as is. */
export type ExplorerSession = ExplorerEmitters & {
  canvas: HTMLCanvasElement;
  options: MeasuredWorldOptions;
  metadata: ClusterManifest;
  scope: AssetScope;
  signal?: AbortSignal;
  diagnosticChannel: ReturnType<typeof createDiagnosticChannel>;
  /** The caller holds the canvas context and the scene: the session frees neither, the next one
   *  opens on them. */
  callerOwned?: boolean;
};

/** The session's outlets; `opening` watches it open under `label` until `opening.done()`. */
export function createExplorerSession(options: MeasuredWorldOptions, label: string) {
  // EXPERIENCE screen-error variant, set before any selection and before the DAG
  // shader is compiled. A session without the option restores ours: nothing inherits.
  setScreenErrorVariant(options.screenError);
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
  const opening = watchOpening(label);
  const diagnose = (phase: string, message: string, context: Record<string, unknown> = {}) => {
    opening.note(phase, message);
    diagnosticChannel.emit({ phase, message, context });
  };
  const preparationStart = performance.now();
  const signal = options.signal;
  const scope = options.scope ?? DEFAULT_SCOPE;
  const progress = (phase: string, completed: number, total: number, message: string) => {
    signal?.throwIfAborted();
    options.onPreparation?.({ phase, completed, total, message });
    diagnose('preparation', message, { kind: 'preparation', phase, completed, total, scope });
  };
  return { diagnosticChannel, emit, diagnose, preparationStart, signal, scope, progress, opening };
}
