import { core } from '../../impostor/borrowed.ts'
import { cardPassWgsl } from './cardWgsl.ts'
import { IMPOSTOR_PASS, IMPOSTOR_VISIBILITY_PASS } from '../../stage/passLabels.ts'
import { computeBufferEntry, computeTextureEntry } from '../../gpu/core/computeBindings.ts'

/**
 * The card pipelines (#1335) and their three group layouts: the image's (view uniform, card
 * records), a mesh's atlas, which the feed fills (`feed.ts`), and the identifiers' (the surface
 * stage's alone). The visibility stages (`visPipeline`) write
 * the card's identifier (`VIS_CARD_BASE | slot`) and the depth: beside the clusters, into the pyramid's level 0 too, with their
 * targets and depth (`VIS_TARGETS`, `VIS_DEPTH`); alone in an image without a drawable row, into
 * the identifiers alone, no pyramid to build. The surface stage (`pipeline`) writes the four
 * opaque surfaces where the identifier the visibility stage kept is the card's own, which it reads
 * from a group of its own (`idsLayout`): no depth, written or compared.
 */
async function makeCardPipelines(device: GPUDevice) {
  const FRAGMENT = GPUShaderStage.FRAGMENT,
    VERTEX = GPUShaderStage.VERTEX
  const imageLayout = device.createBindGroupLayout({
    label: 'Trillion3D impostor image',
    entries: [
      computeBufferEntry(0, 'uniform', VERTEX | FRAGMENT),
      computeBufferEntry(1, 'read-only-storage', VERTEX | FRAGMENT),
    ],
  })
  const atlasLayout = device.createBindGroupLayout({
    label: 'Trillion3D impostor atlas',
    entries: [
      ...[0, 1, 2].map((binding) => computeTextureEntry(binding, 'float', '2d', FRAGMENT)),
      { binding: 3, visibility: FRAGMENT, sampler: { type: 'filtering' as const } },
    ],
  })
  const idsLayout = device.createBindGroupLayout({
    label: 'Trillion3D impostor identifiers',
    entries: [computeTextureEntry(0, 'uint', '2d', FRAGMENT)],
  })
  const module = device.createShaderModule({ label: IMPOSTOR_PASS, code: cardPassWgsl() })
  const layout = device.createPipelineLayout({ bindGroupLayouts: [imageLayout, atlasLayout] })
  const surfaceLayout = device.createPipelineLayout({
    bindGroupLayouts: [imageLayout, atlasLayout, idsLayout],
  })
  const make = (
    label: string,
    entryPoint: string,
    targets: GPUColorTargetState[],
    pipelineLayout: GPUPipelineLayout,
    depthStencil?: GPUDepthStencilState,
  ) =>
    core.buildRenderPipeline(device, {
      label,
      layout: pipelineLayout,
      vertex: { module, entryPoint: 'card_vs' },
      fragment: { module, entryPoint, targets },
      // Four vertex invocations a card, its two triangles a strip (`card_vs`).
      primitive: { topology: 'triangle-strip', cullMode: 'none' },
      ...(depthStencil && { depthStencil }),
    })
  // Compiled together, off the thread (#1362).
  const [pipeline, ids, hiz] = await Promise.all([
    make(
      IMPOSTOR_PASS,
      'card_fs',
      core.SURFACE_FORMATS.map((format) => ({ format })),
      surfaceLayout,
    ),
    make(IMPOSTOR_VISIBILITY_PASS, 'card_vis_fs', [core.VIS_TARGETS[0]], layout, core.VIS_DEPTH),
    make(IMPOSTOR_VISIBILITY_PASS, 'card_vis_hiz_fs', core.VIS_TARGETS, layout, core.VIS_DEPTH),
  ])
  return {
    imageLayout,
    atlasLayout,
    idsLayout,
    pipeline,
    /** The visibility stage's pipeline: with the pyramid's level 0 beside the clusters (`hiz`),
     *  the identifiers alone in an image without a drawable row. */
    visPipeline: (withHiz: boolean) => (withHiz ? hiz : ids),
  }
}

const checked = new WeakMap<GPUDevice, Awaited<ReturnType<typeof makeCardPipelines>>>()

/** The device's card pipelines, those its prepare checked (`prepareImpostorPipelines`). */
export const cardPipelines = (device: GPUDevice) => checked.get(device)!

/**
 * THE CARD PIPELINES CHECKED BEFORE THE FIRST IMAGE (#1336): compiled under the device's validation
 * scope where the session prepares. Refused — a card shader that does not compile, a pipeline that
 * does not link —, the failure is told once (`onFailure`) and the answer is false: the session then
 * keeps no impostor code, as a refused import, so it plans no card and every root keeps its
 * clusters. An invalid pipeline set in a pass would lose every image's commands instead.
 */
export async function prepareImpostorPipelines(
  device: GPUDevice,
  onFailure: (phase: string, error: unknown) => void,
) {
  try {
    checked.set(device, await core.scoped(device, () => makeCardPipelines(device)))
    return true
  } catch (error) {
    onFailure('impostor-card-program-failed', error)
    return false
  }
}
