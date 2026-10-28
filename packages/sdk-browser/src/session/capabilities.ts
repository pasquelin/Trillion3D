import { materialTextures } from '../scene/meshes.ts'
import { families } from './host/families.ts'
import { MAX_ANISOTROPY } from '../materials/texture/maxAnisotropy.ts'
import { SCENE_FILE } from '../scene/tables.ts'
import { DEFAULT_HEIGHT, DEFAULT_PAGE_WORKERS, DEFAULT_WIDTH } from './engine/common.ts'
import { sizeDrawingBuffer } from '../api/viewportApi.ts'
import type { EngineContext } from './engine/types.ts'
import type { ExplorerPageSources } from './pageSources.ts'
import type { ExplorerSession } from './session.ts'
type Inputs = {
  manifestUrl: string
  metadataUrl: string
  base: string
  draws: EngineContext['draws']
  pageSources: ExplorerPageSources
}
/** Sizes the canvas the engine presents into, and reports the session's configuration. */
export async function configureExplorer(session: ExplorerSession, inputs: Inputs) {
  const { canvas, options, scope, metadata, diagnosticChannel, diagnose } = session
  const { manifestUrl, metadataUrl, base, draws, pageSources } = inputs
  const { pages } = pageSources
  const { width = DEFAULT_WIDTH, height = DEFAULT_HEIGHT, pixelRatio } = options
  sizeDrawingBuffer(canvas, width, height, pixelRatio)
  // The provenance table, a family loaded with the scene when a channel listens (`familyUse.ts`);
  // unheard, the record is dropped unread and nothing loads it.
  const sdk = diagnosticChannel.enabled
    ? (await families.measurement.load().catch(() => null))?.SDK_BUILD_PROVENANCE
    : null
  diagnose('configuration', 'Active explorer configuration', {
    kind: 'configuration',
    scope,
    detail: diagnosticChannel.detail,
    limits: {
      maxResidentPages: options.maxResidentPages ?? null,
      pageFetchWorkers: options.pageFetchWorkers ?? DEFAULT_PAGE_WORKERS,
      geometryPoolBytes: options.geometryPoolBytes ?? null,
      texturePoolBytes: options.texturePoolBytes ?? null,
    },
    pageCatalogue: pages.map((page) => ({
      url: page.url,
      bytes: page.bytes,
    })),
    provenance: {
      sdk,
      manifestUrl,
      metadataUrl,
      formatVersion: metadata.formatVersion,
      compilerVersion: metadata.compilerVersion ?? null,
      sourceGltfUrl: new URL(SCENE_FILE, base).href,
    },
  })
  // The most detail: every texture asks the device's whole anisotropy (`MAX_ANISOTROPY`), which the
  // texture filtering's ceilings (`textureFilteringOptions.ts`) then hold to the quality level's.
  if (options.detail === 'maximum') {
    for (const { declaration } of draws)
      for (const material of Array.isArray(declaration) ? declaration : [declaration])
        for (const texture of materialTextures(material)) texture.anisotropy = MAX_ANISOTROPY
  }
}
