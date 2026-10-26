import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { PAGE_INFO_STRUCT_WGSL } from '../../visibility/shader/pageWgsl.ts'
import { FLAG_LIT } from '../../visibility/types.ts'
import { visPageIndex } from '../../visibility/visWords.ts'
import { PIXEL_MODEL, pixelModelOf } from '../../materials/surface/pixelModel.ts'
import { SUBSURFACE_FLAG } from '../../materials/surface/subsurface.ts'
import { SURFACE_MODEL_MASK, UNLIT_FLAG } from '../../materials/surface/surfaceModelWord.ts'
import { packedStorageWgsl } from './bindingsWgsl.ts'
import { COLOR_SPACES_WGSL } from './colorSpaceWgsl.ts'

/**
 * The layers of the render-resolution measures taken before the translucency (`measureFlickerLuma`,
 * `measureThinCoverage`) and of the thin geometry's outputs (`thinRelaxationShader`,
 * `thinGeometryWgsl.ts`), one texture of eight bits a texel a layer (`HistoryFormats.measure`):
 * - `luma`: the flicker luma of the scene before the translucency, in the gamma space — the root of
 *   the measurement luma (`measureLuma`) —, rounded to eight bits by the store;
 * - `coverage`: the material's coverage of the thin geometry, a half where a lit surface covers the
 *   texel, one where it is of a model the shading range calls foliage, none on the background or an
 *   unlit surface;
 * - `mask`: the thin geometry's history relaxation weight in seven bits over the cluster hole bit
 *   (`THIN_MASK_BITS`), after the translucency trimmed it;
 * - `history`: the thin geometry's coverage history (`THIN_COVERAGE_BITS`), which the next image's
 *   reprojection carries.
 * A byte is stored as its value over 255 and read back rounded: exact.
 */
export const MEASURE_LAYERS = { luma: 0, coverage: 1, mask: 2, history: 3 } as const
export const MEASURE_LAYER_COUNT = 4

/** The texels a workgroup of the measures covers across and down: eight by eight lanes, each two by
 *  two texels eight apart. */
export const MEASURE_TILE = 16
const LANES = 8
const ROWS = MEASURE_TILE / LANES

/** The measures' bindings: their uniform (the exposure's scale, the size drawn), the image or the
 *  visibility buffer, and the layer each writes. */
export const MEASURE_BINDINGS = { view: 0, image: 1, ids: 2, pages: 3, out: 4, flags: 5 } as const
/** The words of the measures' uniform. */
export const MEASURE_VIEW_BYTES = 16

const MEASURE_VIEW_WGSL = wgslBlock(
  'MEASURE_VIEW_WGSL',
  [],
  `struct MeasureView{scale:f32,width:f32,height:f32,range:f32,}
@group(0) @binding(${MEASURE_BINDINGS.view}) var<uniform> measure:MeasureView;`,
)

/** The two by two texels a lane of workgroup `wg` measures, `visit` of each inside the image. */
const eachTexel = (visit: string) => `
 let origin=vec2i(wg.xy)*${MEASURE_TILE}+vec2i(i32(lane%${LANES}u),i32(lane/${LANES}u));
 let size=vec2i(i32(measure.width),i32(measure.height));
 for(var y=0;y<${ROWS};y++){for(var x=0;x<${ROWS};x++){
  let p=origin+vec2i(x,y)*${LANES};
  if(any(p>=size)){continue;}
${visit}
 }}`

/**
 * THE FLICKER LUMA MEASURED BEFORE THE TRANSLUCENCY, a pass of its own before the transparent layers
 * are composed onto the image (`../../blend/translucency.ts`): each render texel's luma of the scene,
 * exposed by the image's scale and the shading's exposure offset (`measure.scale`), in the
 * measurement space's luma taken back to the gamma space, stored in eight bits — what the shading
 * rejection's flicker measure and the thin geometry detection read. One load, one store a texel.
 */
export const measureFlickerLumaShader = (format: GPUTextureFormat) =>
  wgslProgram(
    `@group(0) @binding(${MEASURE_BINDINGS.image}) var image:texture_2d<f32>;
@group(0) @binding(${MEASURE_BINDINGS.out}) var lumaOut:texture_storage_2d<${format},write>;
@compute @workgroup_size(${LANES * LANES})
fn measureFlickeringLuma(@builtin(workgroup_id) wg:vec3u,@builtin(local_invocation_index) lane:u32){${eachTexel(
      `  let luma=sqrt(measureLuma(textureLoad(image,p,0).rgb*measure.scale));
  textureStore(lumaOut,p,vec4f(luma,0.0,0.0,0.0));`,
    )}
}`,
    [...packedStorageWgsl(format), MEASURE_VIEW_WGSL, COLOR_SPACES_WGSL],
  )

/**
 * THE MATERIAL'S COVERAGE OF THE THIN GEOMETRY, measured before the translucency where the detection
 * runs: none on the background or an unlit surface, else by the thin geometry shading range
 * (`measure.range`, the index in `THIN_GEOMETRY_SHADING_RANGES`) a half, or one for a surface the range
 * calls foliage — every lit surface under `'all'`, the two-sided foliage (a thin transmission of no
 * pixel model) under the others, the hair too under `'foliageAndHair'`. One identifier load, its page
 * and its surface flags a texel.
 */
export const measureThinCoverageShader = (format: GPUTextureFormat) =>
  wgslProgram(
    `@group(0) @binding(${MEASURE_BINDINGS.ids}) var ids:texture_2d<u32>;
@group(0) @binding(${MEASURE_BINDINGS.pages}) var<storage,read> pages:array<PageInfo>;
@group(0) @binding(${MEASURE_BINDINGS.out}) var coverageOut:texture_storage_2d<${format},write>;
@group(0) @binding(${MEASURE_BINDINGS.flags}) var surfaceFlags:texture_2d<u32>;
@compute @workgroup_size(${LANES * LANES})
fn measureThinGeometryCoverage(@builtin(workgroup_id) wg:vec3u,@builtin(local_invocation_index) lane:u32){${eachTexel(
      `  let id=textureLoad(ids,p,0).r;
  var coverage=0.0;
  if(id!=0u&&(pages[visPageIndex(id)].flags&${FLAG_LIT}u)!=0u){
   let flags=textureLoad(surfaceFlags,p,0).r;
   if((flags&${SURFACE_MODEL_MASK}u)!=${UNLIT_FLAG}u){
    let model=pixelModelOf(flags);
    let foliage=(flags&${SUBSURFACE_FLAG}u)!=0u&&model==0u;
    let hair=model==${PIXEL_MODEL.hair}u&&measure.range==1.0;
    coverage=select(0.5,1.0,foliage||hair||measure.range==2.0);
   }
  }
  textureStore(coverageOut,p,vec4f(coverage,0.0,0.0,0.0));`,
    )}
}`,
    [
      ...packedStorageWgsl(format),
      MEASURE_VIEW_WGSL,
      PAGE_INFO_STRUCT_WGSL,
      visPageIndex,
      pixelModelOf,
    ],
  )

/** A byte of the measures' layers, stored as its value over 255 (`thinRelaxationShader`), read back
 *  exactly. */
export const MEASURE_BYTE_WGSL = wgslBlock(
  'MEASURE_BYTE_WGSL',
  [],
  'fn measureByte(v:f32)->u32{return u32(round(v*255.0));}',
)
