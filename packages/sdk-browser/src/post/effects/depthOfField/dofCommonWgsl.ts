import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { PI } from '../../../../../math/src/wgsl/constants.ts'
import { DEPTH_WGSL } from '../../taa/depthWgsl.ts'
import { COC_TILE, DOF_PARAMS, DOF_STEP, MAX_RECOMBINE_COC } from './dofLayout.ts'

/**
 * What every pass of the depth of field shares: the uniforms, named `view` and `dofStep` (the first is
 * the temporal passes' name for the projection's depth terms, which `DEPTH_WGSL` reads out of it),
 * the constants and the small functions of the circle of confusion, the downsampling of four
 * samples to one, and the tile ranges.
 */

/** The binding every pass reads the uniform at, and the one a repeating pass reads its step at. */
export const DOF_PARAMS_BINDING = 0
export const DOF_STEP_BINDING = 1

/** The uniform `view`. */
export const DOF_PARAMS_WGSL = wgslBlock(
  'DOF_PARAMS_WGSL',
  [],
  `${DOF_PARAMS.wgsl}
@group(0) @binding(${DOF_PARAMS_BINDING}) var<uniform> view:DofParams;`,
)

/** The uniform `dofStep`, of a pass that repeats. */
export const DOF_STEP_WGSL = wgslBlock(
  'DOF_STEP_WGSL',
  [],
  `${DOF_STEP.wgsl}
@group(0) @binding(${DOF_STEP_BINDING}) var<uniform> dofStep:DofStep;`,
)

/**
 * The circle of confusion and its small helpers:
 * - `DOF_EXTREME`, a radius no circle reaches that a half float still holds; `luma4`, the luma of a
 *   colour times 4; `safeRcp`; `affine`, a saturating affine transformation;
 * - `cocOfDepth`: the signed radius, in texels of an image `basis` wide, of a point `depth` metres
 *   away — the circle the lens' focus gives it or the depth blur's, the larger; negative in front of
 *   the focus, positive behind it and where the lens has none —, held to the limits (`cocModel.ts` is
 *   the same model on the processor);
 * - `isForeground`.
 */
export const DOF_COC_WGSL = wgslBlock(
  'DOF_COC_WGSL',
  [DOF_PARAMS_WGSL, DEPTH_WGSL, PI],
  `
const DOF_EXTREME:f32=16384.0;
const DOF_TILE:u32=${COC_TILE}u;
const DOF_SLIGHT:f32=${MAX_RECOMBINE_COC}.0;
const DOF_LUT:f32=32.0;
fn luma4(c:vec3f)->f32{return c.g*2.0+(c.r+c.b);}
fn safeRcp(x:f32)->f32{return select(0.0,1.0/x,x>0.0);}
fn affine(x:f32,t:vec2f)->f32{return saturate(x*t.x+t.y);}
fn isForeground(coc:f32)->bool{return coc<0.0;}
fn cocOfDepth(depth:f32,basis:f32)->f32{
 let radius=((depth-view.lens.w)/depth)*view.coc.x*basis;
 let blur=(1.0-exp2(-depth*view.lens.z))*view.coc.w*basis;
 let signed=max(abs(radius),blur)*select(1.0,-1.0,radius<0.0);
 return clamp(signed,view.coc.y*basis,view.coc.z*basis);
}`,
)

/**
 * Four samples downsampled to one (`dofDownsample`): the circle of confusion of the result is one of
 * the four's — the smallest, at the setup (`fourth`), else the first whose absolute value is no
 * larger than the others' (an erosion of the foreground) —, and the colour their mean weighed by how
 * far each sample's circle is under the chosen one's (`scale` units of 1/64 texel).
 */
export const DOF_DOWNSAMPLE_WGSL = wgslBlock(
  'DOF_DOWNSAMPLE_WGSL',
  [],
  `
struct Down{color:vec4f,coc:f32}
fn downCoc(c:vec4f,fourth:bool)->f32{
 if(fourth){return min(min(c.x,c.y),min(c.z,c.w));}
 var o=c.x;
 if(abs(o)>c.y){o=c.y;}
 if(abs(o)>c.z){o=c.z;}
 if(abs(o)>c.w){o=c.w;}
 return o;
}
fn downWeight(chosen:f32,other:f32,scale:f32)->f32{return saturate(1.0-(chosen-other)*64.0*scale);}
fn dofDownsample(c:array<vec4f,4>,coc:vec4f,scale:f32,fourth:bool)->Down{
 let o=downCoc(coc,fourth);
 let w=vec4f(downWeight(o,coc.x,scale),downWeight(o,coc.y,scale),downWeight(o,coc.z,scale),downWeight(o,coc.w,scale));
 let color=(c[0]*w.x+c[1]*w.y+c[2]*w.z+c[3]*w.w)/(w.x+w.y+w.z+w.w);
 return Down(color,o);
}`,
)

/**
 * A tile of the circle of confusion's range (`CocTile`), as the tile images hold it — the foreground's
 * smallest and largest circle in the first, the background's largest and smallest, the smallest
 * circle a ray can still intersect and the distance to the closest geometry in the second — and
 * what reads and writes it.
 */
export const DOF_TILE_WGSL = wgslBlock(
  'DOF_TILE_WGSL',
  [DOF_COC_WGSL],
  `
struct CocTile{fgMin:f32,fgMax:f32,bgMin:f32,bgMax:f32,bgNear:f32,bgCloser:f32}
fn cocTileOf(coc:f32)->CocTile{
 let fg=min(coc,0.0);
 let bg=max(coc,0.0);
 return CocTile(fg,fg,bg,bg,select(DOF_EXTREME,coc,coc>0.0),0.0);
}
fn cocTileRead(fg:vec4f,bg:vec4f)->CocTile{return CocTile(fg.x,fg.y,bg.y,bg.x,bg.z,bg.w);}
fn cocTileFg(t:CocTile)->vec4f{return vec4f(t.fgMin,t.fgMax,0.0,0.0);}
fn cocTileBg(t:CocTile)->vec4f{return vec4f(t.bgMax,t.bgMin,t.bgNear,t.bgCloser);}`,
)
