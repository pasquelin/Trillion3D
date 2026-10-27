import { alignUp } from '../../../../../math/src/scalar/integers.ts'
import {
  COMPUTE,
  computeBufferEntry,
  computeSamplerEntry,
  computeTextureEntry,
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
import { createKernel, type Kernel } from '../kernel.ts'
import {
  LIGHT_FUNCTION_PASS_BINDINGS,
  LIGHT_FUNCTION_PASS_ENTRY,
  lightFunctionPassBytes,
  lightFunctionPassMapped,
  lightFunctionPassWgsl,
  type LightFunctionPassProgram,
} from './lightFunctionPassWgsl.ts'

/**
 * THE HOST OF THE LIGHT FUNCTIONS EVALUATED APART FROM THE ATLAS (`lightFunctionPassWgsl.ts` says what the pass is): which lights
 * they are (`standaloneLightFunctions`), the program of each light's material, compiled off the frame once for each distinct
 * material (`kernelOf`), the block of each light and of its material, written into one uniform buffer a light at a dynamic
 * offset, and the bits that mark the lights for the cull (`flags`, a bit a light by its rank).
 *
 * A light whose program is not compiled yet, whose texture has not joined the colour atlas of the maps, or whose map the atlas
 * lacks is left out of the image (`pending`): it is lit as one with no light function until it is ready, and the frame is not
 * held meanwhile (`markStandalonePending`). A map not yet read at the detail its slot of the atlas would show keeps its light in,
 * read at the detail there is.
 */

/** What the pass keeps from one image to the next: the bits that mark the lights, and the buffer of the blocks. */
export interface StandaloneState {
  flags: GPUBuffer
  /** The words the flags buffer holds, and the words last written to it. */
  flagWords: number
  flagsHeld: Uint32Array
  given?: GPUBuffer
  givenStride: number
  givenSize: number
}

export function createStandaloneState(device: GPUDevice): StandaloneState {
  return {
    flags: flagsBuffer(device, 1),
    flagWords: 1,
    flagsHeld: new Uint32Array(1),
    givenStride: 0,
    givenSize: 0,
  }
}

const flagsBuffer = (device: GPUDevice, words: number) =>
  device.createBuffer({
    label: 'Trillion3D standalone light functions',
    size: words * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })

/** Gives back the pass's memory. */
export function disposeStandaloneState(state: StandaloneState) {
  state.flags.destroy()
  state.given?.destroy()
}

const kernels = new WeakMap<GPUDevice, Map<string, Kernel<typeof LIGHT_FUNCTION_PASS_ENTRY>>>()

const ro = 'read-only-storage' as const

/** The program of a material, made once for the device for each distinct material (the text its graph compiles to, or a plain
 *  material with or without a map). */
function kernelOf(device: GPUDevice, program: LightFunctionPassProgram) {
  const key = program.graph ? `graph|${program.graph.compiled.key}` : `plain|${program.mapped}`
  let held = kernels.get(device)
  if (!held) kernels.set(device, (held = new Map()))
  let kernel = held.get(key)
  if (!kernel) {
    const B = LIGHT_FUNCTION_PASS_BINDINGS
    kernel = createKernel(
      device,
      'light function',
      lightFunctionPassWgsl(program),
      [LIGHT_FUNCTION_PASS_ENTRY],
      [
        ...(lightFunctionPassMapped(program)
          ? [
              ...atlasLayoutEntries(MAP_BINDINGS, COMPUTE),
              computeSamplerEntry(MAP_SAMPLER_BINDING, 'filtering', COMPUTE),
            ]
          : []),
        computeBufferEntry(B.tables, ro),
        computeBufferEntry(B.context, ro),
        computeTextureEntry(B.depth, 'uint'),
        computeTextureEntry(B.normal, 'float'),
        computeBufferEntry(B.tileLights, ro),
        computeBufferEntry(B.masks, 'storage'),
        computeUniformEntry(B.given, {
          hasDynamicOffset: true,
          minBindingSize: lightFunctionPassBytes(program),
        }),
      ],
    )
    held.set(key, kernel)
  }
  return kernel
}

/** A light ready to be evaluated: its program's kernel, the bytes of its block and the block of its material. */
export interface ReadyLight {
  readonly light: StandaloneLight
  readonly kernel: Kernel<typeof LIGHT_FUNCTION_PASS_ENTRY>
  readonly mapped: boolean
  readonly bytes: number
  readonly material: ArrayBuffer
}

/** One dispatch of an image: the kernel over a light's block, at `offset` of the buffer, `bytes` long. */
interface StandalonePass {
  readonly kernel: Kernel<typeof LIGHT_FUNCTION_PASS_ENTRY>
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
 * compiled for the pass (`graphStandaloneOf`) and its kernel started; its textures are asked to join the colour atlas of the maps
 * and to be read at the detail a slot of `slotSize` texels shows.
 */
export function readyStandalone(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  slotSize: number,
): { ready: ReadyLight[]; pending: boolean } {
  const maps = mapsOf(rt)
  const ready: ReadyLight[] = []
  let pending = false
  for (const light of standaloneLightFunctions(rt)) {
    const { material } = light
    const graph = usableGraphStandalone(material)
    const program: LightFunctionPassProgram = { graph, mapped: !graph && !!material.emissiveMap }
    const kernel = kernelOf(device, program)
    const places = lightFunctionTextures(material).map((texture) => maps.slotOf(texture))
    const mapped = lightFunctionPassMapped(program)
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
    ready.push({ light, kernel, mapped, bytes: lightFunctionPassBytes(program), material: block })
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
  const words = Math.max(1, Math.ceil(rt.lights.store.count / 32))
  if (words > state.flagWords) {
    state.flags.destroy()
    state.flags = flagsBuffer(device, words)
    state.flagWords = words
    state.flagsHeld = new Uint32Array(words)
  }
  const bits = new Uint32Array(state.flagWords)
  for (const { light } of ready) bits[light.slot >> 5] |= 1 << (light.slot & 31)
  if (bits.some((word, at) => word !== state.flagsHeld[at])) {
    device.queue.writeBuffer(state.flags, 0, bits)
    state.flagsHeld = bits
  }
  if (!ready.length) return { passes: [], flags: state.flags, given: undefined }
  const align = device.limits.minUniformBufferOffsetAlignment
  const stride = alignUp(Math.max(...ready.map((r) => r.bytes)), align)
  if (!state.given || state.givenSize < ready.length * stride || state.givenStride !== stride) {
    if (state.given) retire(device, state.given)
    state.givenStride = stride
    state.givenSize = ready.length * stride
    state.given = device.createBuffer({
      label: 'Trillion3D standalone light function blocks',
      size: state.givenSize,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
  }
  const data = new ArrayBuffer(ready.length * stride)
  const maps = mapsOf(rt)
  ready.forEach((r, at) => {
    writeStandaloneLight(data, at * stride, r.light.light, r.light.slot)
    new Uint8Array(data, at * stride + STANDALONE_LIGHT_BYTES, r.material.byteLength).set(
      new Uint8Array(r.material),
    )
  })
  device.queue.writeBuffer(state.given, 0, data)
  return {
    passes: ready.map((r, at) => ({
      kernel: r.kernel,
      offset: at * stride,
      bytes: r.bytes,
      maps: (r.mapped && maps.entries()) || [],
    })),
    flags: state.flags,
    given: state.given,
  }
}
