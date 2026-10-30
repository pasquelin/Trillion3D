import { texelBytesOf } from '../../gpu/core/textureBytes.ts'
import { CLOSURE_FLAGS_FORMAT, CLOSURE_LOBES_FORMAT } from './closureFlags.ts'
import {
  REFLECTION_GRID_FORMAT,
  createKernelTexture,
  createReflectionGrids,
  gridBytes,
  resolvedBytes,
  tilesOf,
} from './grids.ts'
import { createList, listBytes } from '../../gpu/dispatch/list.ts'

/**
 * THE TRACED REFLECTIONS OF A CLOSURE PAST THE FIRST (the reference's `Reflections.cpp:841-872, 1511-1823`: the tiles of the overflow region classified with the closure's
 * index, traced, and resolved into a layer of the resolved target of their own): what the reflections keep for each such closure — its flags (the pixels that
 * hold it, `closureFlags.ts`), its grids (the tile lists, the rays, the screen stage's hits and the history, `grids.ts`), its resolved pixels and its two layers
 * of the reflection target (layers `2k` and `2k + 1`, `layersOf`) — beside the first closure's, which is the view's. Shared with it: the view uniform, the depth,
 * the lit image, the front layer, the hit lighting's state and the kept depth. The kernels are the first closure's, bound to the closure's textures.
 */
export interface ClosureSide {
  /** The closure's index, from 1. */
  readonly closure: number
  /** The surface flags of the pixels that hold the closure (zero elsewhere), written every image. */
  readonly flags: GPUTexture
  readonly flagsView: GPUTextureView
  /** The lobes texel of the pixels that hold the closure (its anisotropy, coat or cloth, `closureFlags.ts`), written with the flags: the lobes target of the kernels that trace the closure. */
  readonly lobes: GPUTexture
  readonly lobesView: GPUTextureView
  /** The resolved pixels the closure's resolve writes and its accumulation reads: not the view's, which the other surfaces use in turn. */
  readonly resolvedView: GPUTextureView
  /** The closure's two layers of the reflection target, as the last pass writes them (layers 0 and 1 of the view). */
  readonly targetView: GPUTextureView
  /** Whether the closure's layers of the target were written by a trace once: until then they hold nothing (black), and the lighting would read no reflection for the closure. */
  written: boolean
  /** The first closure's two layers copied into the closure's, on `encoder`, after the trace wrote them: what the closure reads until its own are written (`written`). */
  copyFirst(encoder: GPUCommandEncoder): void
  /** The tracing tiles its overflow tiles are in, a word each (zero between images), and the list of the marked ones the classification runs over (`trace/closureClassify.ts`). */
  readonly marks: GPUBuffer
  readonly marked: GPUBuffer
  /** The closure's grids, made when first read. */
  readonly grids: ReturnType<typeof createReflectionGrids>
  dispose(): void
}

/** The layers of the reflection target for a record of `closures` closures: two for each. */
export const layersOf = (layers: number, closures: number) => layers * Math.max(1, closures)

/** Bytes the reflections hold for one closure past the first at `width × height`: its grids, its resolved pixels, its flags, and the marks and the list of the tiles its classification lists (`trace/closureClassify.ts`). */
export const closureSideBytes = (width: number, height: number) =>
  gridBytes(width, height, true) +
  resolvedBytes(width, height) +
  width * height * (texelBytesOf(CLOSURE_FLAGS_FORMAT) + texelBytesOf(CLOSURE_LOBES_FORMAT)) +
  4 * tilesOf(width, height) +
  listBytes(tilesOf(width, height), 1)

/** The sides of the closures past the first of a record of `closures` closures, over `target` (laid out by `layersOf`). */
export function createClosureSides(
  device: GPUDevice,
  width: number,
  height: number,
  closures: number,
  target: GPUTexture,
  layers: number,
) {
  const sides: ClosureSide[] = []
  for (let closure = 1; closure < closures; closure++) {
    const storage = GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING
    const make = (name: string, format: GPUTextureFormat, usage: GPUTextureUsageFlags) =>
      device.createTexture({
        label: `Trillion3D reflection closure ${closure} ${name}`,
        size: [width, height],
        format,
        usage,
      })
    // The flags are emptied by a render pass before their kernel writes them; the lobes are written only over the closure's overflow tiles (the kernel of `closureFlags.ts` writes the tiles it lists), the readers going through the flags, which say whether a lobe is there.
    const flags = make('flags', CLOSURE_FLAGS_FORMAT, storage | GPUTextureUsage.RENDER_ATTACHMENT)
    const lobes = make('lobes', CLOSURE_LOBES_FORMAT, storage)
    const resolved = createKernelTexture(
      device,
      `Trillion3D reflection closure ${closure} resolved`,
      [width, height],
      REFLECTION_GRID_FORMAT,
    )
    const marks = device.createBuffer({
      label: `Trillion3D reflection closure ${closure} marks`,
      size: 4 * tilesOf(width, height),
      usage: GPUBufferUsage.STORAGE,
    })
    const marked = createList(
      device,
      `Trillion3D reflection closure ${closure} marked tiles`,
      tilesOf(width, height),
      1,
    )
    let grids: ReturnType<typeof createReflectionGrids> | undefined
    sides.push({
      closure,
      written: false,
      marks,
      marked,
      copyFirst(encoder) {
        encoder.copyTextureToTexture(
          { texture: target },
          { texture: target, origin: [0, 0, layers * closure] },
          [target.width, target.height, layers],
        )
      },
      flags,
      flagsView: flags.createView(),
      lobes,
      lobesView: lobes.createView(),
      resolvedView: resolved.createView(),
      targetView: target.createView({
        dimension: '2d-array',
        baseArrayLayer: layers * closure,
        arrayLayerCount: layers,
      }),
      get grids() {
        grids ??= createReflectionGrids(
          device,
          `Trillion3D reflection closure ${closure} grid`,
          [width, height],
          true,
        )
        return grids
      },
      dispose() {
        flags.destroy()
        lobes.destroy()
        resolved.destroy()
        marks.destroy()
        marked.destroy()
        grids?.destroy()
      },
    })
  }
  return {
    sides,
    dispose() {
      for (const side of sides) side.dispose()
    },
  }
}
export type ClosureSides = ReturnType<typeof createClosureSides>
