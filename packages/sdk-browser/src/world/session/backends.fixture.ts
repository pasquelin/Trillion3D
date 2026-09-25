import { prepareExplorerBackends } from './backends.ts';
import type { BackendContext, RenderBackend } from '../../backend/types.ts';
import type { ClusterManifest } from '../../../../sdk-core/src/index.ts';
import type { ExplorerSession } from './session.ts';

type PageSources = Parameters<typeof prepareExplorerBackends>[1]['pageSources'];

/**
 * The context `prepareExplorerBackends` hands the engines of a session on `metadata`, as one probe
 * engine sees it: `probe` overrides that engine's members, `session` the session's, `options` its
 * load options (imported lights off, since Node serves no `lights.json`).
 */
export async function probeBackendContext(
  metadata: ClusterManifest,
  pageSources: PageSources,
  {
    options = {},
    probe = {},
    session = {},
    base = 'http://localhost/cache/',
  }: {
    options?: object;
    probe?: Partial<RenderBackend>;
    session?: Partial<ExplorerSession>;
    base?: string;
  } = {},
) {
  let seen: BackendContext | undefined;
  const backend = {
    id: 'probe',
    prepare: async () => {},
    dispose: () => {},
    ...probe,
  } as unknown as RenderBackend;
  const opened = {
    canvas: { width: 4, height: 4 },
    options: { ...options, importedLights: false },
    scope: 'full',
    metadata,
    diagnosticChannel: { enabled: false, detail: 'summary', emit: () => {} },
    emit: () => {},
    diagnose: () => {},
    ...session,
  } as unknown as ExplorerSession;
  await prepareExplorerBackends(opened, {
    source: {} as never,
    associations: new Map(),
    textureIndices: new Map(),
    pageSources,
    directGpu: false,
    factories: [
      (context) => {
        seen = context;
        return backend;
      },
    ],
    backends: [],
    base,
  });
  return seen!;
}
