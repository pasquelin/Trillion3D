import { wgslF32 } from '../../../../../math/src/wgsl/number.ts'
import { DEPTH_CLEAR } from '../../../camera/depthConvention.ts'
import { VIS_UNIFORM_BYTES } from '../../../gpu/bind/bindLayout.ts'
import {
  computeBufferEntry,
  computeStorageTextureEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../../../gpu/core/computeBindings.ts'
import { VIS_UNIFORMS_WGSL } from '../../shader/pageWgsl.ts'
import { pixelOffset } from '../../raster/pixelWgsl.ts'
import { workDepthWgsl } from '../../raster/workDepthWgsl.ts'
import { HIZ_LEVEL0_FORMAT } from './level0.ts'
import { HIZ_FORMAT } from './pyramidTexture.ts'
import type { HizDepthSource } from './shader.ts'

/**
 * THE IMAGE'S OWN BUILD OF THE PYRAMID, over the visibility buffer: its first pass reads each
 * pixel's depth where the raster wrote it — the pair's second word with the 64-bit word, else the
 * nearer of the software raster's key and the hardware raster's depth — and writes it into level 0
 * as it goes, so that the readers of level 0 find the depth there and no pass of its own copies the
 * buffer into it. A pixel past the viewport reads the background, as the export did.
 *
 * Level 0's opaque layer is a storage write (binding 1) and its front layer a sampled read
 * (binding 3), two views of two layers of the one texture. The buffer, the view's uniform (the
 * viewport the buffer is laid out by) and, on a device without the 64-bit word, the hardware
 * raster's depth are the second group, which the raster's own resources move (`HizWorkSource`).
 */

/** What the build reads of the visibility buffer: the buffer, the view's uniform and, on a device
 *  without the 64-bit word, the hardware raster's depth texture. */
export type HizWorkSource = {
  work: GPUBuffer
  uniform: GPUBuffer
  hardwareDepth?: GPUTextureView | undefined
}

/** The depth source of a device with (`wide`) or without the 64-bit word. */
export const hizWorkSource = (wide: boolean): HizDepthSource => ({
  bindings: `@group(0) @binding(1) var level0Out:texture_storage_2d<${HIZ_LEVEL0_FORMAT},write>;
@group(0) @binding(3) var frontDepth:texture_2d<f32>;
@group(1) @binding(0) var<storage,read> work:array<${wide ? 'vec2<u32>' : 'u32'}>;
@group(1) @binding(1) var<uniform> uni:Uniforms;
${wide ? '' : '@group(1) @binding(2) var hwDepth:texture_depth_2d;\n'}`,
  reads: `/** The opaque depth of pixel \`q\`: the buffer's (\`depthAt\`), the background past the viewport. */
fn hizOpaqueAt(q:vec2i)->f32{
 let p=vec2u(q);
 if(p.x>=u32(uni.viewport.x)||p.y>=u32(uni.viewport.y)){return ${wgslF32(DEPTH_CLEAR)};}
 return depthAt(p);
}
/** The trace layers' depth at \`q\` whose opaque depth is \`opaque\`: the nearest transparent
 *  surface's folded in where this image wrote it (\`hizUni.front\`). */
fn hizFrontOf(q:vec2i,opaque:f32)->f32{
 if(hizUni.front==0u){return opaque;}
 return hizFoldOf(opaque,textureLoad(frontDepth,q,0).r);
}
/** Level 0 receives the depth it is built from. */
fn hizStoreOpaque(q:vec2i,z:f32){textureStore(level0Out,q,vec4f(z,0.0,0.0,0.0));}
/** Level 0 past the drawn size receives the background, as the export wrote the whole texture: the
 *  texels of the square of the thread \`x, y\` (the first pass's cell) that no read of the build reaches. */
fn hizClearBeyond(x:u32,y:u32){
 let size=textureDimensions(level0Out);
 for(var j=0u;j<2u;j++){
  for(var i=0u;i<2u;i++){
   let p=vec2u(2u*x+i,2u*y+j);
   if((p.x>=hizUni.b||p.y>=hizUni.c)&&p.x<size.x&&p.y<size.y){
    textureStore(level0Out,vec2i(p),vec4f(${wgslF32(DEPTH_CLEAR)},0.0,0.0,0.0));
   }
  }
 }
}
`,
  decls: [VIS_UNIFORMS_WGSL, pixelOffset, workDepthWgsl(wide)],
})

/** The build's group 0: the pyramid, level 0's opaque layer written and its front layer read, the
 *  pass's uniform slot at a dynamic offset. */
export const hizWorkEntries = (uniformBytes: number): GPUBindGroupLayoutEntry[] => [
  computeStorageTextureEntry(0, HIZ_FORMAT, 'read-write', '2d-array'),
  computeStorageTextureEntry(1, HIZ_LEVEL0_FORMAT),
  computeUniformEntry(2, { hasDynamicOffset: true, minBindingSize: uniformBytes }),
  computeTextureEntry(3, 'unfilterable-float'),
]

/** The build's group 1: the visibility buffer, the view's uniform and, without the 64-bit word, the
 *  hardware raster's depth. */
export const hizWorkSourceEntries = (wide: boolean): GPUBindGroupLayoutEntry[] => [
  computeBufferEntry(0, 'read-only-storage'),
  computeUniformEntry(1, { minBindingSize: VIS_UNIFORM_BYTES }),
  ...(wide ? [] : [computeTextureEntry(2, 'depth')]),
]
