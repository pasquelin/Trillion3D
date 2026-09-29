import type { MeasuredWorldOptions } from '../../backend/types.ts';
import type { ExplorerEmitters } from '../session/session.ts';

/** Counts the resources a preparation reads, and tells the host of each as it lands. */
export function resourceProgress(
  options: MeasuredWorldOptions,
  diagnose: ExplorerEmitters['diagnose'],
  scope: string,
  signal: AbortSignal | undefined,
) {
  let total = 0,
    completed = 0;
  return <T>(resource: string, read: Promise<T>) => {
    total++;
    return read.finally(() => {
      completed++;
      if (signal?.aborted) return;
      const message = `Loaded resource: ${decodeURIComponent(resource.split('/').at(-1) ?? resource)}`;
      options.onPreparation?.({ phase: 'resources', completed, total, message });
      diagnose('preparation', message, {
        kind: 'preparation',
        phase: 'resources',
        completed,
        total,
        resource,
        scope,
      });
    });
  };
}
