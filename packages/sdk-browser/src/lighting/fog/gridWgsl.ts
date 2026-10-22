import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import {
  ndcToUv,
  perspectiveDivide,
  unprojectPoint,
  uvToNdc,
} from '../../../../math/src/wgsl/projection.ts'
import { FOG_SLOT } from '../../../../sdk-core/src/scene/core/fog.ts'
import { FLOAT32_MAX } from '../../../../math/src/wgsl/constants.ts'
import { FOG_VOLUME_FLAG } from './frame.ts'

/**
 * THE VOLUME'S CELLS IN THE WORLD: where a cell's sample lies, how deep the surfaces are there, the
 * medium it holds — what every pass of the volume asks of its grid. The program declares the
 * frame (`frame`, `FogVolumeFrame`), the light buffer (`directLights`) and the scene's depth
 * (`fogDepth`); a cell is `(x, y, slice)`, its `offset` the place in it, `(0.5, 0.5, 0.5)` the centre.
 *
 * A cell's point is on the ray through its pixel, at the view depth its slice starts at plus the
 * offset's share of the slice; the ray is the one through the pixel at the near plane
 * (`fogPixelRay`), scaled so its forward component is 1, so that `eye + ray · depth` is the point at
 * that view depth. The cells are cut across the image in pixels, `frame.grid.w` a side from the
 * view's first pixel, the last row and column reaching past its edge where the side does not divide
 * it: the cell \`c\` lies at the pixel \`c · side\`, where a surface and the history find it
 * (\`frame.uv\`). The depth buffer is read at the pixel the cell's sample projects to, through the
 * matrix the buffer was drawn with. A sample the depth buffer has in front of it by less than
 * `tune.y` cells is moved forward, to `tune.x` cells in front of it, so that a cell on a surface
 * does not light itself with what stands behind.
 *
 * The medium is the height fog's, read at the cell's height: its density, the first layer's and the
 * second's summed, halved — the volume reads density as an extinction where the analytic fog reads
 * it as the exponent of two —, times the extinction scale; the particles scatter the particle
 * colour's share of what they extinguish; the glow is the medium's own light.
 */
export const FOG_CELLS_WGSL = wgslBlock(
  'FOG_CELLS_WGSL',
  [unprojectPoint, uvToNdc],
  `
/** The view depth a slice starts at, and the slice of a view depth. */
fn fogDepthAtSlice(slice:f32)->f32{return (exp2(slice/frame.sliceMap.z)-frame.sliceMap.y)/frame.sliceMap.x;}
fn fogSliceAtDepth(depth:f32)->f32{return log2(depth*frame.sliceMap.x+frame.sliceMap.y)*frame.sliceMap.z;}
/** The ray through device coordinates \`ndc\`, its forward component 1. */
fn fogPixelRay(ndc:vec2f)->vec3f{
 let along=unprojectPoint(frame.inverseViewProj,vec3f(ndc,1.0))-frame.eye.xyz;
 return along/dot(along,frame.forward.xyz);
}
/** The cell's point (xyz) and its view depth (w), at \`offset\` within it. */
fn fogCellPoint(cell:vec3u,offset:vec3f)->vec4f{
 let uv=(vec2f(cell.xy)+offset.xy)*frame.grid.w*frame.view.zw;
 let depth=fogDepthAtSlice(max(f32(cell.z)+offset.z,0.0));
 return vec4f(frame.eye.xyz+depth*fogPixelRay(uvToNdc(uv)),depth);
}
`,
)

/** What the cells read of the scene: the depth buffer, the medium. */
export const FOG_GRID_WGSL = wgslBlock(
  'FOG_GRID_WGSL',
  [FOG_CELLS_WGSL, ndcToUv, perspectiveDivide, FLOAT32_MAX],
  `
const FOG_HALF_DENSITY:f32=0.5;
/** The view depth the depth buffer holds at \`pixel\`: its far value, where no surface was drawn, converts
 *  to \`1 / 10⁻⁸\`, the tiny fudge keeping the division finite. */
fn fogSceneDepthAt(pixel:vec2i)->f32{
 let at=clamp(pixel,vec2i(0),vec2i(frame.view.xy)-vec2i(1));
 let z=textureLoad(fogDepth,at,0);
 return frame.depthMap.y/(z-frame.depthMap.x+1e-8*frame.depthMap.y);
}
/** The pixel of the depth buffer the unit-square coordinates \`uv\` fall on. */
fn fogPixelOf(uv:vec2f)->vec2i{return vec2i(floor(uv*frame.view.xy));}
/** \`offset\` moved forward along the depth where the sample lies behind the depth buffer by less
 *  than the threshold of cells (\`tune.x\`, \`tune.y\`); as it is where the offset is negative. */
fn fogLiftOffSurface(cell:vec3u,offset:vec3f)->vec3f{
 var moved=offset;
 if(frame.tune.x>=0.0){
  let clip=frame.depthViewProj*vec4f(fogCellPoint(cell,moved).xyz,1.0);
  let uv=ndcToUv(perspectiveDivide(clip).xy);
  let behind=fogSliceAtDepth(fogSceneDepthAt(fogPixelOf(uv)))-frame.tune.x-(f32(cell.z)+moved.z);
  if(behind<0.0&&-behind<frame.tune.y){moved.z+=behind;}
 }
 return moved;
}
/** A cell's medium: what its particles scatter (xyz) and its extinction (w), per metre, and its
 *  own light. */
struct FogMedium{scattering:vec4f,glow:vec3f,}
fn fogMedium(cell:vec3u)->FogMedium{
 let offset=fogLiftOffSurface(cell,vec3f(0.5));
 let height=fogCellPoint(cell,offset).y;
 let first=directLights.fog[${FOG_SLOT.law}];
 let second=directLights.fog[${FOG_SLOT.second}];
 let density=first.x*exp2(-first.y*(height-first.z))+second.x*exp2(-second.y*(height-second.z));
 let extinction=max(density*FOG_HALF_DENSITY*frame.medium.y,0.0);
 var glow=vec3f(0.0);
 if((u32(frame.medium.w)&${FOG_VOLUME_FLAG.glow}u)!=0u){glow=frame.glow.rgb;}
 return FogMedium(vec4f(frame.particleColor.rgb*extinction,extinction),glow);
}
/** A value kept where it is positive and finite, zero where it is not (a NaN, an infinity, a negative). */
fn fogPositiveFinite(v:vec4f)->vec4f{
 return select(vec4f(0.0),v,(v>=vec4f(0.0))&(v<=vec4f(FLOAT32_MAX)));
}`,
)
