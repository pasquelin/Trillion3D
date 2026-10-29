import { alignUp, ceilDiv } from '../../../../../math/src/scalar/integers.ts'
import {
  COMPUTE,
  computeSamplerEntry,
  computeUniformEntry,
} from '../../../gpu/core/computeBindings.ts'
import { retire } from '../../../gpu/core/frameRetire.ts'
import { atlasLayoutEntries } from '../../../gpu/bind/bindLayout.ts'
import type { WebgpuPagesRuntime } from '../../../frame/backend/runtime.ts'
import { STANDALONE_LIGHT_BYTES, writeStandaloneLight } from '../../lightFunction/entries.ts'
import { standaloneLightFunctions, type StandaloneLight } from '../../lightFunction/frame.ts'
import {
  lightFunctionTextures,
  usableGraphStandalone,
  writeGraphSlot,
} from '../../lightFunction/graphSlot.ts'
import { MAP_BINDINGS, MAP_SAMPLER_BINDING } from '../../lightFunction/mapBindings.ts'
import { joinTexture, mapsOf } from '../../lightFunction/maps.ts'
import type { AtlasFormat } from '../../lightFunction/renderWgsl.ts'
import { createKernel, type Kernel } from '../kernel.ts'
import { shadowMaskLayoutEntries } from './kernels.ts'
import { SHADOW_MASK_STANDALONE_ENTRY } from './shadowMaskWgsl.ts'
import {
  STANDALONE_MASK_GIVEN_BINDING,
  standaloneMaskBytes,
  standaloneMaskMapped,
  standaloneMaskWgsl,
  type StandaloneMaskProgram,
} from './standaloneMaskWgsl.ts'

/**
 * THE HOST OF THE LIGHT FUNCTIONS EVALUATED IN THE MASKS' KERNEL, apart from the atlas (`standaloneMaskWgsl.ts` says what the program is): which lights
 * they are (`standaloneLightFunctions`), the program of each light's material, the mask's own kernel with the material in it, compiled off the frame
 * once for each distinct material and format of the masks (`kernelOf`), the block of each light and of its material, written into one uniform buffer a light at a dynamic
 * offset, and the bits that mark the lights for the cull (`flags`, a bit a light by its rank).
 *
 * A light whose program is not compiled yet, whose texture has not joined the colour atlas of the maps, or whose map the atlas
 * lacks is left out of the image (`pending`): it is lit as one with no light function until it is ready, and the frame is not
 * held meanwhile (`markStandalonePending`). A map not yet read at the detail its slot of the atlas would show keeps its light in,
 * read at the detail there is.
 */

/** What the pass keeps from one image to the next: the bits that mark the lights, and the buffer of the blocks. */
export interface StandaloneState {
  readonly device: GPUDevice
  flags: GPUBuffer
  /** The words the flags buffer holds, those last written to it and the ones the next image makes (the two take turns, so that none is made new for an image). */
  flagWords: number
  flagsHeld: Uint32Array<ArrayBuffer>
  flagsNext: Uint32Array<ArrayBuffer>
  given?: GPUBuffer
  givenStride: number
  givenSize: number
  /** The bytes last written to the blocks' buffer and the ones the next image makes (they take turns too); the buffer is written when they differ. */
  blocksHeld: Uint8Array<ArrayBuffer>
  blocksNext: Uint8Array<ArrayBuffer>
}

export function createStandaloneState(device: GPUDevice): StandaloneState {
  return {
    device,
    flags: flagsBuffer(device, 1),
    flagWords: 1,
    flagsHeld: new Uint32Array(1),
    flagsNext: new Uint32Array(1),
    givenStride: 0,
    givenSize: 0,
    blocksHeld: new Uint8Array(0),
    blocksNext: new Uint8Array(0),
  }
}

const flagsBuffer = (device: GPUDevice, words: number) =>
  device.createBuffer({
    label: 'Trillion3D standalone light functions',
    size: words * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })

/** Gives back the pass's memory, once the frame's work that names it is submitted. */
export function disposeStandaloneState({ device, flags, given }: StandaloneState) {
  retire(device, flags)
  if (given) retire(device, given)
}

const kernels = new WeakMap<GPUDevice, Map<string, Kernel<typeof SHADOW_MASK_STANDALONE_ENTRY>>>()

/** The program of a material over masks in `format`, made once for the device for each distinct material (the text its graph compiles to, or a
 *  plain material with or without a map): the mask's own bindings in group 0, the light's block and the maps in group 1. */
function kernelOf(device: GPUDevice, format: AtlasFormat, program: StandaloneMaskProgram) {
  const key = `${format}|${program.graph ? `graph|${program.graph.compiled.key}` : `plain|${program.mapped}`}`
  let held = kernels.get(device)
  if (!held) kernels.set(device, (held = new Map()))
  let kernel = held.get(key)
  if (!kernel) {
    kernel = createKernel(
      device,
      'shadow masks of a light function',
      standaloneMaskWgsl(program, format),
      [SHADOW_MASK_STANDALONE_ENTRY],
      shadowMaskLayoutEntries(),
      {
        layouts: [
          [
            computeUniformEntry(STANDALONE_MASK_GIVEN_BINDING, {
              hasDynamicOffset: true,
              minBindingSize: standaloneMaskBytes(program),
            }),
            ...(standaloneMaskMapped(program)
              ? [
                  ...atlasLayoutEntries(MAP_BINDINGS, COMPUTE),
                  computeSamplerEntry(MAP_SAMPLER_BINDING, 'filtering', COMPUTE),
                ]
              : []),
          ],
        ],
      },
    )
    held.set(key, kernel)
  }
  return kernel
}

/** A light ready to be evaluated: its program's kernel, the bytes of its block and the block of its material. */
export interface ReadyLight {
  readonly light: StandaloneLight
  readonly kernel: Kernel<typeof SHADOW_MASK_STANDALONE_ENTRY>
  readonly mapped: boolean
  readonly bytes: number
  readonly material: ArrayBuffer
}

/** One dispatch of an image: the kernel over a light's block, at `offset` of the buffer, `bytes` long, over the tiles of the light's
 *  `slot` (its rank) in the compacted list. */
interface StandalonePass {
  readonly slot: number
  readonly kernel: Kernel<typeof SHADOW_MASK_STANDALONE_ENTRY>
  readonly offset: number
  readonly bytes: number
  /** The bind entries of the colour atlas of the maps, none for a material that reads no texture. */
  readonly maps: readonly GPUBindGroupEntry[]
}

/** What the image does with the lights apart from the atlas: the dispatches, the bits that mark the lights, the buffer of the blocks. */
export interface StandalonePrepared {
  readonly passes: readonly StandalonePass[]
  readonly flags: GPUBuffer
  readonly given: GPUBuffer | undefined
}

/**
 * The lights apart from the atlas that are ready this image, and whether one is not (`pending`). Each light's material is
 * compiled for the kernel (`graphStandaloneOf`) and its kernel started; its textures are asked to join the colour atlas of the maps
 * and to be read at the detail a slot of `slotSize` texels shows.
 */
export function readyStandalone(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  format: AtlasFormat,
  slotSize: number,
): { ready: ReadyLight[]; pending: boolean } {
  const maps = mapsOf(rt)
  const ready: ReadyLight[] = []
  let pending = false
  for (const light of standaloneLightFunctions(rt)) {
    const { material } = light
    const graph = usableGraphStandalone(material)
    const program: StandaloneMaskProgram = { graph, mapped: !graph && !!material.emissiveMap }
    const kernel = kernelOf(device, format, program)
    const places = lightFunctionTextures(material).map((texture) => maps.slotOf(texture))
    const mapped = standaloneMaskMapped(program)
    if (!kernel.ready || places.includes(undefined) || (mapped && !maps.entries())) {
      for (const texture of lightFunctionTextures(material))
        if (maps.slotOf(texture) === undefined) joinTexture(rt, texture)
      pending = true
      continue
    }
    if (!maps.warm(material, slotSize)) pending = true
    const block = new ArrayBuffer(graph?.bytes ?? 16)
    if (graph) {
      if (!writeGraphSlot(graph, material, block, rt.run.graphClocks, maps.slotOf)) {
        pending = true
        continue
      }
    } else {
      new Float32Array(block, 0, 3).set(material.surface().emissive)
      new Uint32Array(block, 12, 1)[0] = (places[0] as number | undefined) ?? 0
    }
    ready.push({ light, kernel, mapped, bytes: standaloneMaskBytes(program), material: block })
  }
  return { ready, pending }
}

/**
 * Writes the blocks of `ready` lights, a stride apart, and the bits that mark their lights, and gives the dispatches. With no
 * light, no bit is marked and no dispatch is made.
 */
export function uploadStandalone(
  state: StandaloneState,
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  ready: readonly ReadyLight[],
): StandalonePrepared {
  const words = Math.max(1, ceilDiv(rt.lights.store.count, 32))
  if (words > state.flagWords) {
    retire(device, state.flags)
    state.flags = flagsBuffer(device, words)
    state.flagWords = words
    state.flagsHeld = new Uint32Array(words)
    state.flagsNext = new Uint32Array(words)
  }
  const bits = state.flagsNext.fill(0)
  for (const { light } of ready) bits[light.slot >> 5] |= 1 << (light.slot & 31)
  if (bits.some((word, at) => word !== state.flagsHeld[at])) {
    device.queue.writeBuffer(state.flags, 0, bits)
    state.flagsNext = state.flagsHeld
    state.flagsHeld = bits
  }
  if (!ready.length) return { passes: [], flags: state.flags, given: undefined }
  const align = device.limits.minUniformBufferOffsetAlignment
  const stride = alignUp(Math.max(...ready.map((r) => r.bytes)), align)
  const size = ready.length * stride
  if (!state.given || state.givenSize !== size || state.givenStride !== stride) {
    if (state.given) retire(device, state.given)
    state.givenStride = stride
    state.givenSize = size
    state.given = device.createBuffer({
      label: 'Trillion3D standalone light function blocks',
      size,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
    state.blocksHeld = new Uint8Array(size)
    state.blocksNext = new Uint8Array(size)
    // The new buffer holds nothing: the blocks are written whatever they are.
    state.blocksHeld.fill(0xff)
  }
  const data = state.blocksNext.fill(0)
  const maps = mapsOf(rt)
  ready.forEach((r, at) => {
    writeStandaloneLight(data.buffer, at * stride, r.light.light, r.light.slot)
    data.set(new Uint8Array(r.material), at * stride + STANDALONE_LIGHT_BYTES)
  })
  if (data.some((byte, at) => byte !== state.blocksHeld[at])) {
    device.queue.writeBuffer(state.given, 0, data)
    state.blocksNext = state.blocksHeld
    state.blocksHeld = data
  }
  return {
    passes: ready.map((r, at) => ({
      slot: r.light.slot,
      kernel: r.kernel,
      offset: at * stride,
      bytes: r.bytes,
      maps: (r.mapped && maps.entries()) || [],
    })),
    flags: state.flags,
    given: state.given,
  }
}
