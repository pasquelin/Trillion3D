import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { wgslF32 } from '../../../../math/src/wgsl/number.ts'
import { CENTIMETRES_PER_METRE } from '../../../../sdk-core/src/page/format.ts'
import { DEPTH_WGSL } from '../../post/taa/depthWgsl.ts'
import { hizDepthWgsl } from '../../visibility/hiz/gpu/pyramidTexture.ts'
import { AO_BINDINGS, AO_PARAMS } from './layout.ts'
import { AO_BASIS_SIDE, AO_RANDOM_BASIS } from './tables.ts'

/** Stored depths are divided by this so the half-precision setup texture holds them (in centimetres):
 *  4096 · 32, the reference's own scale. */
const AO_DEPTH_SCALE = 4096 * 32
/** The farthest distance a depth is read as, in centimetres: a pixel with no surface (depth 0) reads this far,
 *  never beyond what the setup texture's half floats hold over the scale above. */
const AO_FAR_CM = 1e7 * CENTIMETRES_PER_METRE

/** A table of vec2 constants as a function of its index (`name(i)`): a branch a row, no array to index. */
export const vec2Table = (name: string, rows: readonly (readonly [number, number])[]) =>
  `fn ${name}(i:u32)->vec2f{\n${rows
    .map(([x, y], at) => ` if(i==${at}u){return vec2f(${wgslF32(x)},${wgslF32(y)});}`)
    .join('\n')}\n return vec2f(0.0);\n}`

/**
 * WHAT EVERY SEARCH READS OF THE IMAGE (`AO_SURFACE_WGSL`), under either method: the surfaces' normals and the depth the image
 * drew with its furthest-depth pyramid (the pass's uniform, named `view` as the depth terms of the temporal passes expect,
 * `DEPTH_WGSL`, with its `lens`, `depth` and `radius` words).
 * - A device depth as a distance in centimetres (`aoDepthCm`, the engine's one conversion, `sceneDepthOf`, held to what the half
 *   floats of the setup hold), a pixel's own depth (`aoSceneDepth`).
 * - A surface's normal, in the world (`aoSurfaceNormal`) or in the view's space (`aoToView`): the surfaces' own, or the depth's,
 *   from the neighbours' depths — the smaller step of each axis, the points they make in the view's space, the cross of the two
 *   (`aoDepthNormal`; a view position, `aoViewPos`, a perspective's `(x, y) · depth` over the projection's scale, an
 *   orthographic one's without the depth; a pixel from a position of the picture, 0 to 1 over the drawn view with y down,
 *   `aoPixelAt`). A surface normal of no length — what the G-buffer holds where nothing was drawn — reads as `(0, 0, 1)`: the
 *   one guard kept (`standardLighting.test.ts`), because the setup's weighted mean would spread a NaN over every silhouette block.
 * - The depth a tap reads (`aoPyramidDepth`, `aoPyramidDepthAt`): one cell of the pyramid — the farthest opaque depth of a block
 *   of 2, 4, 8 pixels…, the cell held to the image's, made from the opaque depth alone, for the engine's other bounds fold in the
 *   transparents' front, which an occlusion of the opaque surfaces must not see —, the level the climb of the samples asks of
 *   it, the first the half-size cells.
 */
export const AO_SURFACE_WGSL = wgslBlock(
  'AO_SURFACE_WGSL',
  [hizDepthWgsl(0, AO_BINDINGS.depth), DEPTH_WGSL],
  `@group(0) @binding(${AO_BINDINGS.normals}) var normals:texture_2d<f32>;
fn aoDepthCm(z:f32)->f32{return min(sceneDepthOf(z)*${wgslF32(CENTIMETRES_PER_METRE)},${wgslF32(AO_FAR_CM)});}
fn aoSceneDepth(pixel:vec2i)->f32{return aoDepthCm(hizOpaqueDepth(pixel));}
fn aoToView(n:vec3f)->vec3f{
 return normalize(vec3f(dot(n,view.right.xyz),dot(n,view.up.xyz),dot(n,view.forward.xyz)));
}
fn aoSurfaceNormal(pixel:vec2i)->vec3f{
 let n=textureLoad(normals,pixel,0).xyz;
 let l=length(n);
 return select(vec3f(0.0,0.0,1.0),n/l,l>0.0);
}
fn aoPixelAt(uv:vec2f)->vec2i{return vec2i(floor(uv*view.lens.zw));}
fn aoViewPos(uv:vec2f,depth:f32)->vec3f{
 let plane=vec2f(uv.x*2.0-1.0,1.0-uv.y*2.0)/view.lens.xy;
 return vec3f(select(plane*depth,plane,view.radius.w>0.5),depth);
}
fn aoTakeSmaller(l:f32,m:f32,r:f32)->f32{
 let a=m-l;
 let b=r-m;
 return select(b,a,abs(a)<abs(b));
}
fn aoDepthNormal(uv:vec2f,mid:vec3f)->vec3f{
 let one=vec2f(1.0)/view.lens.zw;
 let p=aoPixelAt(uv);
 let z=hizOpaqueDepth(p);
 let dx=aoTakeSmaller(hizOpaqueDepth(p+vec2i(-1,0)),z,hizOpaqueDepth(p+vec2i(1,0)));
 let dy=aoTakeSmaller(hizOpaqueDepth(p+vec2i(0,-1)),z,hizOpaqueDepth(p+vec2i(0,1)));
 let right=aoViewPos(uv+vec2f(one.x,0.0),aoDepthCm(z+dx))-mid;
 let down=aoViewPos(uv+vec2f(0.0,one.y),aoDepthCm(z+dy))-mid;
 return normalize(cross(right,down));
}
fn aoPyramidDepthAt(pixel:vec2f,lod:f32)->f32{
 let level=clamp(i32(floor(max(lod,0.0)+0.5)),0,max(hizLevelCount()-2,0));
 return aoDepthCm(hizCellCullFarthest(vec2i(floor(pixel/exp2(f32(level+1)))),level+1));
}
fn aoPyramidDepth(ndc:vec2f,lod:f32)->f32{
 return aoPyramidDepthAt(vec2f(ndc.x*0.5+0.5,0.5-ndc.y*0.5)*view.lens.zw,lod);
}`,
)

/**
 * WHAT EVERY PASS OF THE DISC SEARCH DECLARES: the image's surfaces (`AO_SURFACE_WGSL`), its uniform (`AoParams`), the setup
 * texture it reads and the coarser occlusion (`AO_BINDINGS`) and the noise block's direction for a pixel (`aoNoise`).
 */
export const AO_COMMON_WGSL = wgslBlock(
  'AO_COMMON_WGSL',
  [AO_SURFACE_WGSL],
  `${AO_PARAMS.wgsl}
@group(0) @binding(${AO_BINDINGS.params}) var<uniform> view:AoParams;
@group(0) @binding(${AO_BINDINGS.setup}) var setupTex:texture_2d<f32>;
@group(0) @binding(${AO_BINDINGS.lower}) var lowerAo:texture_2d<f32>;
const AO_DEPTH_SCALE:f32=${wgslF32(AO_DEPTH_SCALE)};
${vec2Table('aoBasis', AO_RANDOM_BASIS)}
fn aoNoise(pixel:vec2i)->vec2f{
 let t=vec2i(floor(vec2f(pixel)+vec2f(0.5)+view.noise.xy));
 return aoBasis(u32(t.x&${AO_BASIS_SIDE - 1})+${AO_BASIS_SIDE}u*u32(t.y&${AO_BASIS_SIDE - 1}));
}`,
)
