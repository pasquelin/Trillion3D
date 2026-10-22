import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { SURFACE_MODEL_MASK, MODEL_FLAG } from '../../../materials/surface/surfaceModel.ts'
import { WORLD_AT_WGSL } from '../../deferred/worldAtWgsl.ts'
import { BOUNCE_GRID_HEAD_WGSL } from '../gridWgsl.ts'

/**
 * THE WEIGHTS OF THE PROBES ROUND A PIXEL: bilinear in the tile, each corner's by how near its plane the pixel's point lies
 * — `exp2(scale · (distance / depth)²)`, the scale the parameters'. A kernel that reads them names the uniform probes it
 * reads (`spCornerProbe(tile)`: a record, or the surface's own where the record is not made yet) beside this block.
 */
export const spWeights = wgslBlock(
  'spWeights',
  [],
  `/** The weights of the four uniform probes of the tile round a pixel: \`w\`, each by its plane and its place in the tile;
 *  \`fallback\`, by a gentler plane, for a pixel the first leaves bare; \`tile\`, the first probe's tile. */
struct SpWeights{w:vec4f,fallback:vec4f,tile:vec2u,}
fn spInterpolation(pixel:vec2u,noise:vec2f,P:vec3f,N:vec3f,depth:f32)->SpWeights{
 let size=vec2f(sp.size.xy);
 let full=clamp(vec2f(pixel)-vec2f(spTileJitter(sp.mode.x))+noise,vec2f(0.0),size-vec2f(1.0));
 let last=max(sp.grid.xy,vec2u(2u))-vec2u(2u);
 let tile=min(vec2u(full/f32(sp.size.z)),last);
 let bilinear=(full-vec2f(tile*sp.size.z)+vec2f(1.0))/f32(sp.size.z+2u);
 let edge=sp.grid.xy-vec2u(1u);
 let a=spCornerProbe(tile);
 let b=spCornerProbe(min(tile+vec2u(1u,0u),edge));
 let c=spCornerProbe(min(tile+vec2u(0u,1u),edge));
 let e=spCornerProbe(min(tile+vec2u(1u,1u),edge));
 let plane=dot(P,N);
 let away=vec4f(abs(dot(a.P,N)-plane),abs(dot(b.P,N)-plane),abs(dot(c.P,N)-plane),abs(dot(e.P,N)-plane))/depth;
 let relative=away*away;
 let valid=vec4<bool>(a.depth>0.0,b.depth>0.0,c.depth>0.0,e.depth>0.0);
 let blend=vec4f(
  (1.0-bilinear.y)*(1.0-bilinear.x),(1.0-bilinear.y)*bilinear.x,
  bilinear.y*(1.0-bilinear.x),bilinear.y*bilinear.x);
 let depthWeights=select(vec4f(0.0),exp2(sp.weights.x*relative),valid);
 let fallbackWeights=select(vec4f(0.0),exp2(sp.weights.y*relative),valid);
 return SpWeights(blend*depthWeights,blend*fallbackWeights,tile);
}
/** The weight of an adaptive probe at pixel \`probePixel\`, of world point \`probe\`, for a pixel: its plane's, as the uniform
 *  ones', and its nearness along the nearer axis of the tile's side; the fallback's in \`y\`. */
fn spAdaptiveWeight(pixel:vec2u,P:vec3f,N:vec3f,depth:f32,probePixel:vec2u,probe:vec3f)->vec2f{
 let away=abs(dot(probe,N)-dot(P,N))/depth;
 let relative=away*away;
 let across=abs(vec2f(probePixel)-vec2f(pixel));
 let corner=1.0-saturate(min(across.x,across.y)/f32(sp.size.z));
 return vec2f(exp2(sp.weights.x*relative),exp2(sp.weights.y*relative))*corner;
}`,
)

/**
 * The surface a pixel shows, as every screen-probe kernel reads it: the image's depth through the depth
 * pyramid's first level (`hizOpaqueDepth`), the normal and the surface flags at `normals` and `flags`
 * of group 0. A pixel is lit when a surface was drawn there (a depth above zero: reverse-Z) of a model that
 * the light reaches — the physical, diffuse and toon ones — and its normal is one.
 */
export const spSurface = (normals: number, flags: number) =>
  wgslBlock(
    `spSurface(${normals}, ${flags})`,
    [WORLD_AT_WGSL],
    `@group(0) @binding(${normals}) var sceneNormals:texture_2d<f32>;
@group(0) @binding(${flags}) var sceneFlags:texture_2d<u32>;
struct SpSurface{lit:bool,P:vec3f,N:vec3f,z:f32,}
fn spSurfaceAt(pix:vec2u)->SpSurface{
 let coord=vec2i(pix);
 let z=hizOpaqueDepth(coord);
 let model=textureLoad(sceneFlags,coord,0).r&${SURFACE_MODEL_MASK}u;
 let n=textureLoad(sceneNormals,coord,0).xyz;
 let facing=dot(n,n)>0.5;
 let lit=z>0.0&&facing&&(model==${MODEL_FLAG.physical}u||model==${MODEL_FLAG.diffuse}u||model==${MODEL_FLAG.toon}u);
 return SpSurface(lit,worldAt(vec2f(pix)+vec2f(0.5),z),select(vec3f(0.0,0.0,1.0),normalize(n),facing),z);
}`,
  )

/** The probes' records as a kernel reads them: the world point and signed depth, the normal and speed
 *  (`spReadProbe`), `probeCounts` the adaptive probes placed (`spProbeLive`), and the record of a probe placed or an
 *  empty one where the index is past them (`spProbeOrDead`). */
export const spProbes = (info: number, normal: number, counts: number) =>
  wgslBlock(
    `spProbes(${info}, ${normal}, ${counts})`,
    [],
    `@group(0) @binding(${info}) var probeInfo:texture_2d<f32>;
@group(0) @binding(${normal}) var probeNormal:texture_2d<f32>;
@group(0) @binding(${counts}) var<storage,read> probeCounts:array<u32>;
fn spReadProbe(atlas:vec2u)->SpProbe{
 let a=textureLoad(probeInfo,vec2i(atlas),0);
 let n=textureLoad(probeNormal,vec2i(atlas),0);
 return SpProbe(a.xyz,a.w,n.xyz,n.w);
}
fn spProbeLive(index:u32)->bool{
 return index<sp.counts.y+min(probeCounts[0],sp.grid.w);
}
fn spProbeOrDead(atlas:vec2u)->SpProbe{
 if(spProbeLive(spIndexOf(atlas))){return spReadProbe(atlas);}
 return SpProbe(vec3f(0.0),-1.0,vec3f(0.0),0.0);
}`,
  )

/**
 * THE RANGE THE SCREEN IS TRUSTED TO, and the scene is traced over: the reach of a probe's cell (`spLocalReach`),
 * twice the diagonal of the cell of the finest cascade level that holds the probe (`bounceRead`, the rule the
 * field is read by), or the scene's limit where none does. A kernel names the bounce grid (`bounce`) beside this block.
 */
export const spReach = wgslBlock(
  'spReach',
  [BOUNCE_GRID_HEAD_WGSL],
  `const SP_CELL_REACH:f32=${2 * Math.sqrt(3)};
fn spLocalReach(P:vec3f,N:vec3f)->f32{
 if(bounce.counts.w==0u){return SP_MAX_TRACE;}
 for(var level=0u;level<CASCADE_LEVELS;level++){
  if(level>=bounce.counts.y){break;}
  let read=bounceRead(level,P,N);
  if(read.holds&&read.fade>0.0){return min(SP_MAX_TRACE,bounce.levels[level].spacing*SP_CELL_REACH);}
 }
 return SP_MAX_TRACE;
}`,
)
