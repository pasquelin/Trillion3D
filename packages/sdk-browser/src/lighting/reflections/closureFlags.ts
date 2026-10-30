import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { preparedComputePipeline } from '../deferred/fullscreen.ts'
import {
  computeBufferEntry,
  computeStorageTextureEntry,
  computeTextureEntry,
} from '../../gpu/core/computeBindings.ts'
import { oncePerDevice } from '../../gpu/core/oncePerDevice.ts'
import { arrayView } from '../../gpu/core/textureViews.ts'
import {
  SURFACE_WORDS_FORMAT,
  closureFlagsLayerOf,
  closuresHeldOf,
} from '../../materials/surface/surfaceOutputs.ts'
import {
  PHYSICAL_LOBES_FORMAT,
  PHYSICAL_SURFACE_FLAG,
} from '../../materials/surface/physicalLobes.ts'
import type { SurfaceBuffer } from '../../materials/surface/surfaceBuffer.ts'
import type { ClosureTiles } from '../../visibility/closureTiles/closureTiles.ts'
import {
  CLOSURE_REGION_HEAD,
  CLOSURE_TILE_SIZE,
  closureArgsAt,
  closureRegionOf,
  overflowTilesBlock,
} from '../../visibility/closureTiles/closureTilesWgsl.ts'

/**
 * THE SURFACE FLAGS OF A CLOSURE PAST THE FIRST, the pixel data the reflections read of it (the reference's packed pixel data of that closure,
 * `StochasticLighting.cpp:795-816` clearing it, the reference's `Reflections.usf:114,194` reading it by the overflow tile entry's closure index): a kernel over the overflow
 * tiles of the closure (`closureTilesOf`, indirect over `closureArgsAt`) writes, for each pixel of those tiles that holds the closure (its normal is not zero,
 * `closureClears`), the closure's own flags (the pixel's with the closure's specular and lobe mark, `SURFACE_CLOSURES`) and its lobes texel, and zero (no surface) for one that does not; the texture is emptied before it, so the pixels outside the overflow
 * tiles are none. The pixel's shading model is the graph's, the pixel's; the closure's lobes (a coat, a skew, a cloth) are its own. The reflections' kernels then read the closure through the readers of the first closure's, bound to this texture, to the lobes texture and to the closure's
 * normal and roughness (`SurfaceBuffer.closureNormals`).
 */
export const CLOSURE_FLAGS_ENTRY = 'closureFlagsMain'

/** The bindings of the kernel, in group 0. */
export const CLOSURE_FLAGS_BINDINGS = {
  words: 0,
  normals: 1,
  flags: 2,
  tiles: 3,
  lobes: 4,
} as const
const B = CLOSURE_FLAGS_BINDINGS

/** The format of the flags: the surface words' (`SURFACE_WORDS_FORMAT`). */
export const CLOSURE_FLAGS_FORMAT = SURFACE_WORDS_FORMAT

/** The format of the lobes: the lobes target's. */
export const CLOSURE_LOBES_FORMAT = PHYSICAL_LOBES_FORMAT

export const closureFlagsWgsl = () =>
  wgslProgram(
    `@group(0) @binding(${B.words}) var words:texture_2d_array<u32>;
@group(0) @binding(${B.normals}) var closureNormals:texture_2d<f32>;
@group(0) @binding(${B.flags}) var closureFlags:texture_storage_2d<${CLOSURE_FLAGS_FORMAT},write>;
@group(0) @binding(${B.lobes}) var closureLobes:texture_storage_2d<${CLOSURE_LOBES_FORMAT},write>;
@compute @workgroup_size(${CLOSURE_TILE_SIZE},${CLOSURE_TILE_SIZE},1)
fn ${CLOSURE_FLAGS_ENTRY}(@builtin(workgroup_id) group:vec3u,@builtin(local_invocation_id) lane:vec3u){
 let tile=overflowTileAt(group);
 if(tile.z==0u){return;}
 let pixel=tile.xy*${CLOSURE_TILE_SIZE}u+lane.xy;
 if(any(pixel>=textureDimensions(closureFlags))){return;}
 var flags=0u;
 var lobes=vec4u(0u);
 // A pixel that holds no such closure shows a normal of zero, which no surface has.
 if(any(textureLoad(closureNormals,vec2i(pixel),0).xyz!=vec3f(0.0))){
  // The closure's index is in its entry; its flags and lobes texel are in the layers after the coverages.
  let closure=(overflowList[${CLOSURE_REGION_HEAD}u+group.y*overflowList[1]+group.x]>>24u)&15u;
  let at=closureFlagsLayerOf(closuresHeldOf(textureNumLayers(words)),closure);
  flags=textureLoad(words,vec2i(pixel),at,0).x;
  if((flags&${PHYSICAL_SURFACE_FLAG}u)!=0u){
   lobes=vec4u(textureLoad(words,vec2i(pixel),at+1u,0).x,textureLoad(words,vec2i(pixel),at+2u,0).x,textureLoad(words,vec2i(pixel),at+3u,0).x,textureLoad(words,vec2i(pixel),at+4u,0).x);
  }
 }
 textureStore(closureFlags,vec2i(pixel),vec4u(flags,0u,0u,0u));
 textureStore(closureLobes,vec2i(pixel),lobes);
}`,
    [overflowTilesBlock(B.tiles), closuresHeldOf, closureFlagsLayerOf],
  )

const LABEL = 'Trillion3D reflection closure flags'
/** The layout and the kernel of a device, prepared off the frame. */
const programOf = oncePerDevice((device: GPUDevice) => {
  const layout = device.createBindGroupLayout({
    label: LABEL,
    entries: [
      computeTextureEntry(B.words, 'uint', '2d-array'),
      computeTextureEntry(B.normals, 'unfilterable-float'),
      computeStorageTextureEntry(B.flags, CLOSURE_FLAGS_FORMAT),
      computeBufferEntry(B.tiles, 'read-only-storage'),
      computeStorageTextureEntry(B.lobes, CLOSURE_LOBES_FORMAT),
    ],
  })
  const module = device.createShaderModule({ label: LABEL, code: closureFlagsWgsl() })
  return {
    layout,
    kernel: preparedComputePipeline(device, {
      layout: device.createPipelineLayout({ label: LABEL, bindGroupLayouts: [layout] }),
      compute: { module, entryPoint: CLOSURE_FLAGS_ENTRY },
    }),
  }
})

/** The kernel of a device, once it is compiled; asked (started) until then. */
export function closureFlagsKernel(device: GPUDevice) {
  return programOf(device).kernel.get()
}

/** What a closure's flags texture was bound over: the group is made again when one of them is another. */
interface Bound {
  readonly words: GPUTexture
  readonly normals: GPUTextureView
  readonly list: GPUBuffer
  readonly group: GPUBindGroup
}
const bound = new WeakMap<GPUTexture, Bound>()

/**
 * The flags of the closure `closure` (from the second, 1) written into `flags` on `encoder`: the texture emptied, then the kernel over the closure's
 * overflow tiles. False where the kernel is not compiled yet or the view lists no tiles of that closure: the closure traces nothing this image.
 */
export function encodeClosureFlags(
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  surfaces: Pick<SurfaceBuffer, 'words' | 'closureNormals' | 'closures'>,
  tiles: ClosureTiles | undefined,
  closure: number,
  flags: GPUTexture,
  flagsView: GPUTextureView,
  lobesView: GPUTextureView,
) {
  const kernel = closureFlagsKernel(device)
  const normals = surfaces.closureNormals[closure - 1]
  if (!kernel || !tiles || closure >= tiles.closures || !normals) return false
  let held = bound.get(flags)
  if (
    !held ||
    held.words !== surfaces.words ||
    held.normals !== normals ||
    held.list !== tiles.list
  ) {
    const { layout } = programOf(device)
    held = {
      words: surfaces.words,
      normals,
      list: tiles.list,
      group: device.createBindGroup({
        label: LABEL,
        layout,
        entries: [
          { binding: B.words, resource: arrayView(surfaces.words) },
          { binding: B.normals, resource: normals },
          { binding: B.flags, resource: flagsView },
          { binding: B.lobes, resource: lobesView },
          {
            binding: B.tiles,
            resource: { buffer: tiles.list, ...closureRegionOf(tiles.tiles, closure) },
          },
        ],
      }),
    }
    bound.set(flags, held)
  }
  encoder
    .beginRenderPass({
      label: LABEL,
      colorAttachments: [
        { view: flagsView, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] },
      ],
    })
    .end()
  const pass = encoder.beginComputePass({ label: LABEL })
  pass.setPipeline(kernel)
  pass.setBindGroup(0, held.group)
  pass.dispatchWorkgroupsIndirect(tiles.args, closureArgsAt(closure))
  pass.end()
  return true
}
