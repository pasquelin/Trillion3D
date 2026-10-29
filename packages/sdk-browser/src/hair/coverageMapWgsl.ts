import { wgslProgram } from '../../../math/src/wgsl/assemble.ts'
import { HAIR_IMAGE_WGSL } from './imageBlock.ts'
import { HAIR_COVERAGE_WGSL } from './ribbonWgsl.ts'
import { TRANSMITTANCE_VERTEX } from './transmittanceWgsl.ts'
import { HAIR_COVERAGE_LUT_SIZE } from './coverageLut.ts'
import { HAIR_TILE_SIZE, HAIR_TRANSMITTANCE_FORMAT } from './visibilityMath.ts'

/** The fixed point a pixel's sum of coverages is counted in: a share is added as this many units. */
const COUNT_SCALE = 4096
/** The width a strand's mean share is mapped to the table's axis with: a share is a radius over the radius of a pixel's one sample, twice what the table's axis holds. */
const WIDTH_SCALE = 2

/**
 * THE COUNT OF THE STRANDS OF A PIXEL AND THEIR SUMMED COVERAGE (`hairVisibilityCoverageMapping`): the ribbons of the view's transmittance
 * drawn again, a sample a pixel and tested against the opaque depth in the shader, each fragment adding its share (`strandCoverage`) to the
 * pixel's first word, in fixed point, and one to its second.
 */
export const HAIR_COVERAGE_COUNT_WGSL = wgslProgram(
  `@group(1) @binding(1) var sceneDepth:texture_depth_2d;
@group(1) @binding(3) var<storage,read_write> counts:array<atomic<u32>>;
${TRANSMITTANCE_VERTEX}
@fragment fn hairCoverageCount(@builtin(position) position:vec4f,@location(0) radius:f32){
 if(position.z<textureLoad(sceneDepth,vec2i(position.xy),0)){return;}
 let at=2u*(u32(position.y)*u32(view.size.x)+u32(position.x));
 atomicAdd(&counts[at],u32(strandCoverage(radius,position.w)*${COUNT_SCALE}.0+0.5));
 atomicAdd(&counts[at+1u],1u);
}`,
  [HAIR_COVERAGE_WGSL],
)

/**
 * THE TRANSMITTANCE FROM THE COUNT, a thread a pixel of the tiles of the strands' rectangle: the mean share of the strands of the pixel,
 * twice (the table's axis), and their count, read in the table of coverage with a bilinear read clamped to its edges (the row is the count's, the
 * last for a larger one), give the coverage of the pixel; the transmittance is one less it, written over the product's. A pixel with no
 * strand has the first row, which covers nothing, and a transmittance of 1.
 */
export const HAIR_COVERAGE_MAP_WGSL = wgslProgram(
  `@group(0) @binding(1) var<storage,read> counts:array<u32>;
@group(0) @binding(2) var<storage,read> coverageTable:array<f32>;
@group(0) @binding(3) var transmittance:texture_storage_2d<${HAIR_TRANSMITTANCE_FORMAT},write>;
const TABLE_LAST=${HAIR_COVERAGE_LUT_SIZE - 1}u;
fn tableAt(count:u32,column:u32)->f32{return coverageTable[min(count,TABLE_LAST)*${HAIR_COVERAGE_LUT_SIZE}u+column];}
@compute @workgroup_size(${HAIR_TILE_SIZE},${HAIR_TILE_SIZE},1) fn hairCoverageMap(@builtin(workgroup_id) block:vec3u,@builtin(local_invocation_id) local:vec3u){
 let pixel=(block.xy+image.origin)*${HAIR_TILE_SIZE}u+local.xy;
 if(!all(pixel<image.size)){return;}
 let at=2u*(pixel.y*image.size.x+pixel.x);
 let count=counts[at+1u];
 var width=0.0;
 if(count>0u){width=saturate(f32(counts[at])/${COUNT_SCALE}.0/f32(count)*${WIDTH_SCALE}.0);}
 let x=width*${HAIR_COVERAGE_LUT_SIZE}.0-0.5;
 let first=floor(x);
 let c0=u32(max(first,0.0));
 let c1=min(u32(max(first+1.0,0.0)),TABLE_LAST);
 let coverage=mix(tableAt(count,c0),tableAt(count,c1),x-first);
 textureStore(transmittance,vec2i(pixel),vec4f(saturate(1.0-coverage),0.0,0.0,0.0));
}`,
  [HAIR_IMAGE_WGSL],
)
