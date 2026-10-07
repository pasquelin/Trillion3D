import { prepareExplorerEngine } from './engine.ts'
import type { EngineContext, Engine } from '../../engine/types.ts'
import type { ClusterManifest } from '../../../../sdk-core/src/index.ts'
import type { ExplorerSession } from './session.ts'

type PageSources = Parameters<typeof prepareExplorerEngine>[1]['pageSources']

/**
 * The context `prepareExplorerEngine` hands the engine of a session on `metadata`, as a probe
 * engine sees it: `probe` overrides that engine's members, `session` the session's, `options` its
 * load options (imported lights off, since Node serves no `lights.json`).
 */
export async function probeEngineContext(
  metadata: ClusterManifest,
  pageSources: PageSources,
  {
    options = {},
    probe = {},
    session = {},
    base = 'http://localhost/cache/',
  }: {
    options?: object
    probe?: Partial<Engine>
    session?: Partial<ExplorerSession>
    base?: string
  } = {},
) {
  let seen: EngineContext | undefined
  const backend = {
    id: 'probe',
    prepare: async () => {},
    dispose: () => {},
    hostTableBytes: () => 0,
    ...probe,
  } as unknown as Engine
  const opened = {
    canvas: { width: 4, height: 4 },
    options: { ...options, importedLights: false },
    scope: 'full',
    metadata,
    diagnosticChannel: { enabled: false, detail: 'summary', emit: () => {} },
    emit: () => {},
    diagnose: () => {},
    ...session,
  } as unknown as ExplorerSession
  await prepareExplorerEngine(opened, {
    source: {} as never,
    associations: new Map(),
    textureIndices: new Map(),
    pageSources,
    factory: (context) => {
      seen = context
      return backend
    },
    base,
    worldRoots: [],
  })
  return seen!
}
