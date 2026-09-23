import { loadClusterManifest } from './manifestLoad.ts';
import type { ClusterManifest, AssetScope } from '../sdk-core/src/index.ts';
import type { createDiagnosticChannel } from './diagnosticChannel.ts';

type Diagnose = (phase: string, message: string, context?: Record<string, unknown>) => void;

export async function loadExplorerManifest(
  manifestUrl: string,
  scope: AssetScope,
  signal: AbortSignal | undefined,
  diagnose: Diagnose,
  diagnosticChannel: ReturnType<typeof createDiagnosticChannel>,
) {
  let metadataUrl: string;
  let metadata: ClusterManifest;
  let loadedBase: string;
  try {
    const loaded = await loadClusterManifest(manifestUrl, scope, signal);
    ({ metadata, metadataUrl } = loaded);
    loadedBase = loaded.base;
    diagnose('manifest', 'Manifeste lu', {
      kind: 'preparation',
      phase: 'manifest',
      scope,
      manifestUrl,
      metadataUrl,
      ...loaded.timing,
    });
  } catch (error) {
    diagnose('error', 'Manifest or cache preparation failed', {
      kind: 'error',
      phase: 'manifest',
      error: String(error),
      scope,
      manifestUrl,
    });
    diagnosticChannel.flushSync();
    diagnosticChannel.close();
    throw error;
  }
  return { metadata, metadataUrl, loadedBase };
}
