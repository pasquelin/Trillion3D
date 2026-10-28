// The surface cache's atlas read back: the texels of rectangles of the physical atlas, counted on
// the GPU, and what the cache did in its last image over the pages it holds and the tiles listed to be lit.
import { ceilDiv } from '../../../packages/math/src/scalar/integers.ts'
import { isMapped } from '../../../packages/sdk-core/src/lighting/surfaceCache/state.ts'
import type { WebgpuPagesRuntime } from '../../../packages/sdk-browser/src/frame/backend/runtime.ts'
import { dispatchGrid } from '../../../packages/sdk-browser/src/gpu/dispatch/grid.ts'
import { INVALID_DEPTH_WORD } from '../../../packages/sdk-browser/src/lighting/surfaceCache/layout.ts'
import {
  CONTEXT_AT,
  CONTEXT_HEADER_WORDS,
} from '../../../packages/sdk-browser/src/lighting/surfaceCache/lighting/layout.ts'
import {
  WORD_LIGHT_FORMAT,
  lightAtlasScalar,
  type LightAtlasFormat,
} from '../../../packages/sdk-browser/src/gpu/core/lightAtlasFormat.ts'
import { autoKernel, computeReadback } from '../../kit/device/computeReadback.ts'
import { wordReader } from './cardShadowRead.ts'

/** The texels of rectangles of the physical atlas, counted on the GPU: for each rectangle `(minX, minY, maxX, maxY)` the
 *  texels, those whose depth word is a surface's (under `INVALID_DEPTH_WORD`, as `surfaceTexel` reads it), those
 *  whose direct light is not zero, the least depth word and the greatest raw word. The atlas's layers are textures
 *  the proof reads by load, as the lighting does. */
function rectCounter(device: GPUDevice, light: LightAtlasFormat) {
  const pipeline = device.createComputePipeline(
    autoKernel(
      device.createShaderModule({
        code: `@group(0) @binding(0) var<storage,read> rects:array<vec4u>;
@group(0) @binding(1) var depth:texture_2d<u32>;
@group(0) @binding(2) var direct:texture_2d<${lightAtlasScalar(light)}>;
@group(0) @binding(3) var<storage,read_write> counts:array<vec4u>;
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) n:vec3u){
 let i=id.x+id.y*n.x*64u;
 if(i>=arrayLength(&rects)){return;}
 let r=rects[i];
 var valid=0u;
 var lit=0u;
 var low=0xffffffffu;
 var raw=0u;
 for(var y=r.y;y<r.w;y++){
  for(var x=r.x;x<r.z;x++){
   let word=textureLoad(depth,vec2i(i32(x),i32(y)),0).x;
   if((word&0xffffu)<${INVALID_DEPTH_WORD}u){valid++;}
   low=min(low,word&0xffffu);
   raw=max(raw,word);
   if(${light === WORD_LIGHT_FORMAT ? 'textureLoad(direct,vec2i(i32(x),i32(y)),0).x!=0u' : 'any(textureLoad(direct,vec2i(i32(x),i32(y)),0).xyz!=vec3f(0.0))'}){lit++;}
  }
 }
 counts[i]=vec4u((r.z-r.x)*(r.w-r.y),valid,lit,low);
 counts[arrayLength(&rects)+i]=vec4u(raw,0u,0u,0u);
}`,
      }),
    ),
  )
  return async (rects: number[][], depth: GPUTextureView, direct: GPUTextureView) => {
    if (rects.length === 0) return []
    const read = await computeReadback(
      device,
      pipeline,
      rects.length * 32,
      dispatchGrid(ceilDiv(rects.length, 64)),
      { inputs: [new Uint32Array(rects.flat()), depth, direct], words: 'u32' },
    )
    return rects.map((_, i) => ({
      texels: read[i * 4],
      valid: read[i * 4 + 1],
      lit: read[i * 4 + 2],
      lowDepth: read[i * 4 + 3],
      rawMax: read[(rects.length + i) * 4],
    }))
  }
}

/** The sum of counted rectangles: texels, valid-depth texels, lit texels, the least depth word and the greatest raw word. */
const total = (
  counted: { texels: number; valid: number; lit: number; lowDepth: number; rawMax: number }[],
) => ({
  rectangles: counted.length,
  texels: counted.reduce((n, c) => n + c.texels, 0),
  valid: counted.reduce((n, c) => n + c.valid, 0),
  lit: counted.reduce((n, c) => n + c.lit, 0),
  lowDepth: counted.reduce((n, c) => Math.min(n, c.lowDepth), 0xffffffff),
  rawMax: counted.reduce((n, c) => Math.max(n, c.rawMax), 0),
})

/**
 * Where the depth of the cards went: what the surface cache did in its last image (the metrics it keeps, the pages it holds
 * mapped, pending and captured, its raster and shading), and what its physical atlas holds — the texels that hold a surface
 * and those that hold light, over the whole atlas, over the pages the cache maps and have been captured, and over the pages
 * of the tiles listed to be lit. Read from the runtime's state (`rt.surfaceCache`) and its atlas layers.
 */
export async function readAtlas(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const frame = rt.surfaceCache
  const atlases = frame?.atlases
  if (!frame || !atlases) return { cache: !!frame, atlases: false }
  const { cache, metrics } = frame
  const rects: number[][] = []
  const readable = new Map<number, number>()
  let mapped = 0,
    pending = 0
  for (let i = 0; i < cache.pages.length; i++) {
    if (!cache.pages.has(i)) continue
    const page = cache.pages.at(i)
    if (!isMapped(page)) continue
    mapped++
    if (page.pending) pending++
    else readable.set(i, rects.push([page.minX, page.minY, page.maxX, page.maxY]) - 1)
  }
  const pageRects = rects.length
  // The whole atlas, in squares of 64 texels.
  for (let y = 0; y < atlases.side; y += 64)
    for (let x = 0; x < atlases.side; x += 64)
      rects.push([x, y, Math.min(x + 64, atlases.side), Math.min(y + 64, atlases.side)])
  const counted = await rectCounter(device, cache.light as LightAtlasFormat)(
    rects,
    atlases.physical.depth,
    atlases.physical.direct,
  )

  // The pages of the tiles the last image listed to be lit: the list follows the context's header.
  const context = frame.lighting?.resources?.context
  const read = wordReader(device)
  const listedTiles = context ? (await read(context, CONTEXT_AT.listed, 1))[0] : 0
  const listedWords = context ? await read(context, CONTEXT_HEADER_WORDS, listedTiles) : []
  const listedPages = new Set(Array.from(listedWords, (word) => word & 0xffffff))
  const inListed = [...listedPages].flatMap((page) => {
    const at = readable.get(page)
    return at === undefined ? [] : [counted[at]]
  })
  return {
    cache: true,
    atlases: true,
    side: atlases.side,
    compressed: atlases.compressed,
    work: metrics && { ...metrics },
    state: {
      pagesKnown: cache.pages.length,
      mapped,
      pending,
      captured: cache.captured.size,
      recapture: cache.recapture.size,
      unlocked: cache.unlocked.size,
      updateFrame: cache.frame,
      shadingReady: frame.shading?.ready ?? null,
      kernelsReady: frame.kernels?.ready ?? null,
      rasterFailure: frame.raster.failure ? String(frame.raster.failure) : null,
      busy: frame.busy,
      updated: frame.updated,
      why: frame.why,
    },
    wholeAtlas: total(counted.slice(pageRects)),
    mappedPages: total(counted.slice(0, pageRects)),
    listedPages: {
      listedTiles,
      pages: listedPages.size,
      notReadable: listedPages.size - inListed.length,
      ...total(inListed),
    },
  }
}
