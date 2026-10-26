import { retire } from '../../gpu/core/frameRetire.ts'
import { askedComputeStage, dispatchOn } from '../../gpu/core/computeStages.ts'
import { computeBufferEntry, computeTextureEntry } from '../../gpu/core/computeBindings.ts'
import { TILE_CLASSIFICATION_PASS } from '../../diagnostic/stage/passLabels.ts'
import { createPassGroup } from './passGroup.ts'
import { TILE_ARGS_BYTES, tileListBytes, tilesAcross } from './tileClass.ts'
import { CLASSIFY_WGSL } from './classifyWgsl.ts'

/** The classification's pipeline, bind group and indirect draws. */
function classificationParts(device: GPUDevice, failed: (error: unknown) => void) {
  const layout = device.createBindGroupLayout({
    entries: [
      computeTextureEntry(0, 'uint', '2d-array'),
      computeBufferEntry(1, 'uniform'),
      computeBufferEntry(2, 'storage'),
      computeBufferEntry(3, 'storage'),
    ],
  })
  const stage = askedComputeStage(
    device,
    [layout],
    CLASSIFY_WGSL,
    'classifyMain',
    TILE_CLASSIFICATION_PASS,
    failed,
  )
  const group = createPassGroup(device, layout)
  const draws = device.createBuffer({
    label: 'Trillion3D tile draws',
    size: TILE_ARGS_BYTES,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST,
  })
  return { stage, group, draws }
}

/**
 * The classification's resources and its pass: the lists of the three classes and their indirect
 * draws, sized for the images drawn (grown, never shrunk), and the compute pass that fills them
 * (`classifyMain`). The pipeline is asked now, off the frame; `failed` hears a failure to compile.
 */
export function createTileClassification(device: GPUDevice, failed: (error: unknown) => void) {
  const { stage, group, draws } = classificationParts(device, failed)
  let lists: GPUBuffer | undefined
  const listed = () => {
    if (!lists) throw new Error('TILE_LISTS_UNSIZED')
    return lists
  }
  const descriptor: GPUComputePassDescriptor = { label: TILE_CLASSIFICATION_PASS }
  return {
    /** The three classes' indirect draws (`tileArgsAt`). */
    draws,
    /** The lists of the three classes (`tileCount` words each), after `ensure`. */
    get lists() {
      return listed()
    },
    /** Sizes the lists for an image of `width` × `height`: the buffer is made again, larger, when
     *  it is too small for it. */
    ensure(width: number, height: number) {
      const bytes = tileListBytes(width, height)
      if (lists && lists.size >= bytes) return
      if (lists) retire(device, lists)
      lists = device.createBuffer({
        label: 'Trillion3D tile lists',
        size: bytes,
        usage: GPUBufferUsage.STORAGE,
      })
    },
    /** Classifies the `width` × `height` pixels of the surfaces' word layers `words`, the view
     *  uniform `view` giving the size drawn. */
    encode(
      encoder: GPUCommandEncoder,
      words: GPUTextureView,
      view: GPUBuffer,
      width: number,
      height: number,
    ) {
      const held = listed()
      encoder.clearBuffer(draws)
      const bound = group.get([words, view, draws, held], () => [
        { binding: 0, resource: words },
        { binding: 1, resource: { buffer: view } },
        { binding: 2, resource: { buffer: draws } },
        { binding: 3, resource: { buffer: held } },
      ])
      // Asked where the deferred lighting is made, before any frame: a skip leaves the draws cleared, so
      // the lit passes draw nothing (no state moves on).
      const pass = encoder.beginComputePass(descriptor)
      dispatchOn(pass, stage, bound, tilesAcross(width), tilesAcross(height))
      pass.end()
    },
    dispose() {
      group.release()
      draws.destroy()
      lists?.destroy()
      lists = undefined
    },
  }
}
