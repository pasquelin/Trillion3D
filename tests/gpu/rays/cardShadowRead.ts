// The card shadow chain read back from the lighting's buffers: a kernel of the proof that reads
// words of the buffers the engine keeps, whether the traced path was taken, and what the last
// image's card shadows left in the masks and the traces.
import { ceilDiv } from '../../../packages/math/src/scalar/integers.ts'
import type { WebgpuPagesRuntime } from '../../../packages/sdk-browser/src/frame/backend/runtime.ts'
import { dispatchGrid, groupWidth } from '../../../packages/sdk-browser/src/gpu/dispatch/grid.ts'
import { autoKernel, computeReadback } from '../../kit/device/computeReadback.ts'
import {
  CONTEXT_ARGS,
  CONTEXT_AT,
  CONTEXT_HEADER_WORDS,
  SHADOW_MASK,
  SHADOW_TRACE,
} from '../../../packages/sdk-browser/src/lighting/surfaceCache/lighting/layout.ts'

/** The mask byte's format, as literals on purpose and not read from `SHADOW_MASK`: this proof is an
 *  independent oracle of it. A texel's byte holds its factor on 7 bits (at most 127) and, above them,
 *  the flag (0x80) that it is settled; a light tile's mask is 8 × 8 of them. */
const FACTOR_MAX = 127,
  COMPLETE = 0x80,
  BYTE = 0xff,
  TILE = 8

/** Words of a buffer the engine keeps, read back by a kernel of the proof: the engine's lighting
 *  buffers are storage and indirect buffers that cannot be copied from, but can be bound to read. */
export function wordReader(device: GPUDevice) {
  const pipeline = device.createComputePipeline(
    autoKernel(
      device.createShaderModule({
        code: `struct Span{offset:u32,count:u32}
@group(0) @binding(0) var<storage,read> span:Span;
@group(0) @binding(1) var<storage,read> source:array<u32>;
@group(0) @binding(2) var<storage,read_write> into:array<u32>;
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) n:vec3u){
 let i=id.x+id.y*n.x*64u;
 if(i<span.count&&span.offset+i<arrayLength(&source)){into[i]=source[span.offset+i];}
}`,
      }),
    ),
  )
  return async (source: GPUBuffer, offset: number, count: number) => {
    const words = Math.max(0, Math.min(count, source.size / 4 - offset))
    if (words === 0) return []
    return computeReadback(device, pipeline, words * 4, dispatchGrid(ceilDiv(words, 64)), {
      inputs: [new Uint32Array([offset, words]), { buffer: source }],
      words: 'u32',
    })
  }
}

/** The byte of the texel `(x, y)` of the mask of light tile `lightTile`: its factor on 7 bits, the top
 *  bit set where it is settled (`shadowMaskWgsl.ts`). */
const maskByte = (masks: ArrayLike<number>, lightTile: number, x: number, y: number) => {
  const bit = SHADOW_MASK.rayBits * (x + y * TILE)
  return (masks[lightTile * SHADOW_MASK.tileWords + (bit >> 5)] >>> (bit & 31)) & BYTE
}

/** Whether the traced path of the surface cache's lighting was taken, as the lighting's state says
 *  (`surfaceLighting.ts`): why it was not, and whether its traced buffers and scene trace are made. */
function tracedPathOf(rt: WebgpuPagesRuntime) {
  const lighting = rt.surfaceCache?.lighting
  return {
    lightingWhy: lighting?.why ?? null,
    tracedBuffers: !!lighting?.tracedBuffers,
    sceneTrace: !!lighting?.sceneTrace,
  }
}

/** What the last image's card shadows left in the lighting's buffers: the count of the traces, the
 *  tiles listed, the trace pass's dispatch, and the masks of the listed light tiles. */
export async function readChain(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const read = wordReader(device)
  const lighting = rt.surfaceCache?.lighting
  const path = tracedPathOf(rt)
  const out = {
    path,
    listed: 0,
    lightTiles: 0,
    traces: 0,
    dispatch: [0, 0, 0],
    expectedDispatch: [0, 0, 0],
    texels: 0,
    complete: 0,
    incomplete: 0,
    factorZero: 0,
    tracedTexels: 0,
    tracedStillIncomplete: 0,
    tracedShadowed: 0,
  }
  const context = lighting?.resources?.context
  if (!lighting || !context) return out
  const header = await read(context, 0, CONTEXT_HEADER_WORDS)
  out.listed = header[CONTEXT_AT.listed]
  const slot = CONTEXT_AT.args + 4 * CONTEXT_ARGS.shadowTraces
  out.dispatch = header.slice(slot, slot + 3)
  const traced = lighting.tracedBuffers,
    maxLights = lighting.shaped?.maxLights
  if (!traced || !maxLights || out.listed === 0) return out
  out.traces = (await read(traced.traces, 0, 1))[0]
  const groups = ceilDiv(out.traces, 64),
    width = groupWidth(device.limits)
  out.expectedDispatch = [Math.min(groups, width), ceilDiv(Math.max(groups, 1), width), 1]

  // The lights each listed tile keeps, and so the light tiles whose masks the mask pass wrote.
  const tileLights = await read(lighting.resources!.tileLights, 0, out.listed * (maxLights + 1))
  const masks = await read(traced.masks, 0, out.listed * maxLights * SHADOW_MASK.tileWords)
  const written = new Set<number>()
  for (let tile = 0; tile < out.listed; tile++)
    for (let k = 0; k < tileLights[tile * (maxLights + 1)]; k++) written.add(tile * maxLights + k)
  out.lightTiles = written.size
  for (const lightTile of written)
    for (let y = 0; y < TILE; y++)
      for (let x = 0; x < TILE; x++) {
        const byte = maskByte(masks, lightTile, x, y)
        out.texels++
        if (byte & COMPLETE) out.complete++
        else out.incomplete++
        if ((byte & FACTOR_MAX) === 0) out.factorZero++
      }

  // The texels the mask pass listed as traces: each must be settled now, and the sun's shadow must
  // have taken the factor of some of them to 0.
  const limit = traced.traces.size / 4 - 1
  const listed = await read(traced.traces, 1, Math.min(out.traces, limit))
  for (const word of listed) {
    const lightTile = word & (2 ** SHADOW_TRACE.lightTileBits - 1)
    const x = (word >>> SHADOW_TRACE.xShift) & SHADOW_TRACE.coordMask,
      y = (word >>> SHADOW_TRACE.yShift) & SHADOW_TRACE.coordMask
    if (!written.has(lightTile)) continue
    const byte = maskByte(masks, lightTile, x, y)
    out.tracedTexels++
    if (!(byte & COMPLETE)) out.tracedStillIncomplete++
    else if ((byte & FACTOR_MAX) === 0) out.tracedShadowed++
  }
  return out
}
