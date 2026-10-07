import { mathBatchMetrics, prepareMathBatch } from '../../math/batchState.ts'
import { materialTextures, meshes as objects } from '../../scene/meshes.ts'
import { hostTextureWritten } from '../../host/textureImport.ts'
import { families } from '../../host/families.ts'
import { MAX_ANISOTROPY } from '../../texture/maxAnisotropy.ts'
import { SCENE_FILE } from '../../scene/tables.ts'
import {
  DEFAULT_HEIGHT,
  DEFAULT_PAGE_WORKERS,
  DEFAULT_WIDTH,
  devicePixels,
} from '../../engine/common.ts'
import type { EngineContext } from '../../engine/types.ts'
import type { createExplorerPageSources } from './pageSources.ts'
import type { ExplorerSession } from './session.ts'
type Inputs = {
  manifestUrl: string
  metadataUrl: string
  base: string
  source: EngineContext['source']
  pageSources: Awaited<ReturnType<typeof createExplorerPageSources>>
}
/** Sizes the canvas the engine presents into, and reports the session's configuration. */
export async function configureExplorer(session: ExplorerSession, inputs: Inputs) {
  const { canvas, options, scope, metadata, diagnosticChannel, diagnose } = session
  const { manifestUrl, metadataUrl, base, source, pageSources } = inputs
  const { pages, cacheCap } = pageSources
  const batchCompute = prepareMathBatch(options.mathPath ?? 'auto')
  canvas.width = devicePixels(options.width ?? DEFAULT_WIDTH, options.pixelRatio)
  canvas.height = devicePixels(options.height ?? DEFAULT_HEIGHT, options.pixelRatio)
  await batchCompute
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
      maxCachedPages: cacheCap,
      pageFetchWorkers: options.pageFetchWorkers ?? DEFAULT_PAGE_WORKERS,
      geometryPoolBytes: options.geometryPoolBytes ?? null,
      texturePoolBytes: options.texturePoolBytes ?? null,
    },
    pageCatalogue: pages.map((page) => ({
      url: page.url,
      bytes: page.bytes,
    })),
    mathBatch: mathBatchMetrics(),
    provenance: {
      sdk,
      manifestUrl,
      metadataUrl,
      formatVersion: metadata.formatVersion ?? metadata.schema,
      schema: metadata.schema,
      compilerVersion: metadata.compilerVersion ?? null,
      sourceGltfUrl: new URL(SCENE_FILE, base).href,
    },
  })
  // The most detail: every texture read with the device's whole anisotropy (`MAX_ANISOTROPY`).
  if (options.detail === 'maximum') {
    for (const mesh of objects(source))
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material])
        for (const texture of materialTextures(material)) {
          texture.anisotropy = MAX_ANISOTROPY
          texture.needsUpdate = true
        }
    hostTextureWritten()
  }
}
