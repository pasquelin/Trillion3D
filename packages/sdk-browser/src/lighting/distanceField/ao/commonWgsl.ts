import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import {
  deviceDepthOfView,
  pixelToNdc,
  unprojectPoint,
} from '../../../../../math/src/wgsl/projection.ts'
import { wgslConsts } from '../../../../../math/src/wgsl/consts.ts'
import {
  AO_DOWNSAMPLE,
  CONE_DIRECTIONS,
  CONE_STEPS,
  CONE_TRACE_DOWNSAMPLE,
  TILE_SIZE,
} from './cones.ts'
import { DFAO_BINDING, DFAO_PARAMS } from './layout.ts'

/** The largest depth the grid holds: a half float's, held short of its infinity. */
export const DFAO_FAR_CM = 65500

/**
 * WHAT EVERY PASS OF THE DISTANCE-FIELD OCCLUSION DECLARES: its uniform (`dfao`, `DFAO_PARAMS`), and the geometry
 * they share — the order the steps of a cone are spaced in, the frame a surface's cones are turned into, the place
 * of a cone-grid cell on the screen and in the grid, the device depth of a distance in metres, the
 * distance from a point to a box.
 *
 * A cone-grid cell stands for 4 × 4 cells of the normals and depths grid, itself half the scene's pixels: the cell
 * `coord` reads the grid's cell `coord · 4 + jitter` (the jitter in the uniform: whole cells), and its position is
 * that of the scene pixel at the top left of the grid's cell, at its centre. A step of a cone is at
 * `scale · ((exponent · i)² + 1)` from the surface. The box distance is the sum of the axes, as the reference's is.
 */
export const DFAO_COMMON_WGSL = wgslBlock(
  'DFAO_COMMON_WGSL',
  [pixelToNdc, unprojectPoint, deviceDepthOfView],
  `${wgslConsts({
    AO_DOWNSAMPLE,
    CONE_TRACE_DOWNSAMPLE,
    CONE_STEPS,
    CONE_DIRECTIONS,
    TILE_SIZE,
    DFAO_NO_TILE: 0xffff,
  })}
${DFAO_PARAMS.wgsl}
@group(0) @binding(${DFAO_BINDING.params}) var<uniform> dfao:DfaoParams;
const DFAO_FAR:f32=${DFAO_FAR_CM}.0;
fn dfaoStepOffset(index:f32)->f32{
 let t=dfao.distances.z*index;
 return dfao.distances.y*(t*t+1.0);
}
struct DfaoAxes{x:vec3f,y:vec3f,}
fn dfaoAxes(n:vec3f)->DfaoAxes{
 let up=select(vec3f(1.0,0.0,0.0),vec3f(0.0,0.0,1.0),abs(n.z)<0.999);
 let x=normalize(cross(up,n));
 return DfaoAxes(x,cross(n,x));
}
fn dfaoConeDirection(i:u32,n:vec3f,a:DfaoAxes)->vec3f{
 let d=dfao.directions[i].xyz;
 return d.x*a.x+d.y*a.y+d.z*n;
}
fn dfaoWorldAt(ndc:vec2f,cm:f32)->vec3f{
 return unprojectPoint(dfao.unprojectToWorld,vec3f(ndc,deviceDepthOfView(dfao.depth,cm*0.01)));
}
fn dfaoCellTexel(coord:vec2u)->vec2i{
 return vec2i(coord*CONE_TRACE_DOWNSAMPLE)+vec2i(dfao.jitter.xy);
}
fn dfaoCellNdc(coord:vec2u)->vec2f{
 let pixel=(vec2f(coord)*f32(CONE_TRACE_DOWNSAMPLE)+dfao.jitter.xy)*f32(AO_DOWNSAMPLE)+vec2f(0.5);
 return pixelToNdc(pixel,vec2f(dfao.grid.zw));
}
fn dfaoBoxDistance(mins:vec3f,maxs:vec3f,p:vec3f)->f32{
 let toMin=select(vec3f(0.0),abs(p-mins),p<mins);
 let toMax=select(vec3f(0.0),abs(p-maxs),p>maxs);
 return dot(toMin,vec3f(1.0))+dot(toMax,vec3f(1.0));
}
fn dfaoVisibilityIndex(cone:u32,base:u32)->u32{return cone*dfao.cones.x*dfao.cones.y+base;}
fn dfaoSafeNormal(v:vec3f)->vec3f{
 let l=length(v);
 return select(vec3f(0.0,0.0,1.0),v/max(l,1e-20),l>1e-6);
}`,
)
