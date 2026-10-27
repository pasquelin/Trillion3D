import { wgslProgram } from '../../../math/src/wgsl/assemble.ts'
import { FULLSCREEN_XY } from '../gpu/shader/fullscreenTriangle.ts'
import { HAIR_IMAGE_WGSL } from './imageBlock.ts'
import { HAIR_COVERAGE_WGSL } from './ribbonWgsl.ts'
import { HAIR_TILE_SIZE, HAIR_TRANSMITTANCE_FORMAT } from './visibilityMath.ts'

/** The vertices a segment is drawn with. */
export const SEGMENT_VERTICES = 6
/** `1.0` as the bits of a float: a word of the product's buffer holds its transmittance's bits
 *  xor this, so that a word of zero is a pixel no strand touched. */
const ONE_BITS = 0x3f800000

/**
 * THE TRANSMITTANCE OF THE VIEW: for each pixel, the product over the strands' fragments in front of
 * the opaque surface of what each lets through, `1 - coverage`, where a fragment's coverage is its
 * strand's (`HAIR_COVERAGE_WGSL`). The ribbons are drawn once, a sample a pixel, into an `r32float`
 * cleared to 1, in a pass that tests them against the opaque depth, read only.
 *
 * **With 32-bit float blending** (`float32-blendable`, `../gpu/core/gpuCaps.ts`) each
 * fragment multiplies the target by its share, `dst * src`, by the blend unit, and the depth unit
 * drops the fragments behind the opaque depth (the nearer or equal passes).
 * **Without it** the same product is taken in a buffer by a compare-and-swap on the float's bits
 * (the order of the factors, which a product does not depend on but for its last bit, is the
 * threads'), and a pass resolves the buffer into the texture. The test of the depth is then the
 * shader's: a fragment that writes a buffer is not dropped by the depth unit before it runs.
 *
 * The pass clears the depth of the nearest strand too (`HairImageTargets`), which its pipelines write
 * nothing to.
 */
export const TRANSMITTANCE_WGSL = wgslProgram(
  `@group(1) @binding(1) var sceneDepth:texture_depth_2d;
@group(1) @binding(2) var<storage,read_write> bits:array<atomic<u32>>;
const ONE_BITS=${ONE_BITS}u;
struct VsOut{@builtin(position) position:vec4f,@location(0) radius:f32}
@vertex fn hairTransmittanceVs(@builtin(vertex_index) vertex:u32)->VsOut{
 var result:VsOut;
 result.position=vec4f(0.0,0.0,0.0,1.0);
 result.radius=0.0;
 let segment=vertex/${SEGMENT_VERTICES}u;
 if(!segmentDrawn(segment)){return result;}
 let k=vertex%${SEGMENT_VERTICES}u;
 let tip=cornerTip(k);
 if(!spineValid(select(segment+1u,segment,tip))){return result;}
 let spine=spineAt(select(segment,segment+1u,tip));
 if(!spine.ok){return result;}
 result.position=cornerClip(spine,cornerRight(k));
 result.radius=spine.radius;
 return result;
}
@fragment fn hairTransmittanceBlend(@builtin(position) position:vec4f,@location(0) radius:f32)->@location(0) f32{
 return saturate(1.0-strandCoverage(radius,position.w));
}
@fragment fn hairTransmittanceProduct(@builtin(position) position:vec4f,@location(0) radius:f32){
 if(position.z<textureLoad(sceneDepth,vec2i(position.xy),0)){return;}
 let factor=saturate(1.0-strandCoverage(radius,position.w));
 let at=u32(position.y)*u32(view.size.x)+u32(position.x);
 var held=atomicLoad(&bits[at]);
 loop{
  let next=bitcast<u32>(bitcast<f32>(held^ONE_BITS)*factor)^ONE_BITS;
  let exchange=atomicCompareExchangeWeak(&bits[at],held,next);
  if(exchange.exchanged){break;}
  held=exchange.old_value;
 }
}`,
  [HAIR_COVERAGE_WGSL],
)

/** The product's buffer written into the texture, a thread a pixel of the tiles of the strands'
 *  rectangle. */
export const RESOLVE_WGSL = wgslProgram(
  `@group(0) @binding(1) var<storage,read> bits:array<u32>;
@group(0) @binding(2) var transmittance:texture_storage_2d<${HAIR_TRANSMITTANCE_FORMAT},write>;
const ONE_BITS=${ONE_BITS}u;
@compute @workgroup_size(${HAIR_TILE_SIZE},${HAIR_TILE_SIZE},1) fn hairTransmittanceResolve(@builtin(workgroup_id) block:vec3u,@builtin(local_invocation_id) local:vec3u){
 let pixel=(block.xy+image.origin)*${HAIR_TILE_SIZE}u+local.xy;
 if(!all(pixel<image.size)){return;}
 textureStore(transmittance,vec2i(pixel),vec4f(bitcast<f32>(bits[pixel.y*image.size.x+pixel.x]^ONE_BITS),0.0,0.0,0.0));
}`,
  [HAIR_IMAGE_WGSL],
)

/**
 * THE CLEAR OF THE TRANSMITTANCE over a rectangle, to 1 (no strand lets less through): the full-screen
 * triangle drawn within the scissor of the tiles of the strands' rectangle, so that the pixels outside
 * them, which no pass reads, are left as they are.
 */
export const CLEAR_TARGETS_WGSL = `@vertex fn hairClearTargetsVs(@builtin(vertex_index) i:u32)->@builtin(position) vec4f{return vec4f(${FULLSCREEN_XY},0.0,1.0);}
@fragment fn hairClearTargetsFs()->@location(0) f32{return 1.0;}`
