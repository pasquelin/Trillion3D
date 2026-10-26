import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import {
  depthOfLogSlice,
  logSliceOfDepth,
  ndcToUv,
  perspectiveDivide,
  unprojectPoint,
  uvToNdc,
} from '../../../../math/src/wgsl/projection.ts'
import { rand4dPcg32 } from '../../../../math/src/wgsl/sampling.ts'
import { FLOAT32_MAX } from '../../../../math/src/wgsl/constants.ts'
import { wgslF32 } from '../../../../math/src/wgsl/number.ts'
import { FOG_VOLUME_FLAG } from './frame.ts'
import { FOG_DEPTH_FUDGE } from './layout.ts'
import { FOG_LAW_WGSL } from './lawWgsl.ts'
import { LOCAL_FOG_FLAG } from './localLayout.ts'
import { FOG_LOCAL_MEDIUM_WGSL } from './localWgsl.ts'

/**
 * THE VOLUME'S CELLS IN THE WORLD: where a cell's sample lies, how deep the surfaces are there, the
 * medium it holds — what every pass of the volume asks of its grid. The program declares the
 * frame (`frame`, `FogVolumeFrame`), the light buffer (`directLights`) and the scene's depth
 * (`fogDepth`); a cell is `(x, y, slice)`, its `offset` the place in it, `(0.5, 0.5, 0.5)` the centre.
 *
 * A cell's point is on the ray through its pixel, at the view depth its slice starts at plus the
 * offset's share of the slice; the ray is the one through the pixel at the near plane
 * (`fogNearPoint`), scaled so its forward component is 1, so that `eye + ray · depth` is the point at
 * that view depth. The cells are spread over the view: the cell \`c\` of \`frame.grid.xy\` lies at
 * \`c / frame.grid.xy\` of it, so that the last row and column end at the view's edge, a little
 * narrower than the others where the side does not divide it. An orthographic view has parallel rays:
 * the cell's point is the near plane's point of its pixel moved along the forward to the view depth,
 * and its depth buffer is linear in the view depth (`frame.depthMap.z` says which the view is). The
 * depth buffer is read at the pixel the cell's sample projects to, through the matrix the buffer was
 * drawn with. A sample the depth buffer has in front of it by less than
 * `tune.y` cells is moved forward, to `tune.x` cells in front of it, so that a cell on a surface
 * does not light itself with what stands behind.
 *
 * The medium is the height fog's, read at the cell's height by the law the analytic fog reads
 * (`fogDensityAt`, `lawWgsl.ts`): its density, the first layer's and the second's summed, halved —
 * the volume reads density as an extinction where the analytic fog reads it as the exponent of two —,
 * times the extinction scale; the particles scatter the particle colour's share of what they
 * extinguish; the glow is the medium's own light, which follows the medium's density where the fog is
 * made to match the volume (`FOG_VOLUME_FLAG.matches`): the glow in the fog's unit times the density
 * in that unit, per centimetre. The local fog volumes add theirs (`fogLocalMedium`). The objects of the volume material
 * domain add to it what the voxelisation held for the cell (`voxelWgsl.ts`): their scattering to
 * the particles', their extinction to the extinction, their emissive light to the glow.
 */
export const FOG_CELLS_WGSL = wgslBlock(
  'FOG_CELLS_WGSL',
  [unprojectPoint, uvToNdc, logSliceOfDepth, depthOfLogSlice],
  `
/** The view depth a slice starts at, and the slice of a view depth. */
fn fogDepthAtSlice(slice:f32)->f32{return depthOfLogSlice(slice,frame.sliceMap.xyz);}
fn fogSliceAtDepth(depth:f32)->f32{return logSliceOfDepth(depth,frame.sliceMap.xyz);}
/** Whether the view is an orthographic one. */
fn fogOrtho()->bool{return frame.depthMap.z>0.5;}
/** The point the ray through device coordinates \`ndc\` reaches at the near plane, from the eye. */
fn fogNearPoint(ndc:vec2f)->vec3f{return unprojectPoint(frame.inverseViewProj,vec3f(ndc,1.0))-frame.eye.xyz;}
/** The ray through the pixel \`at\` (in cells of the grid), found once for every depth it is asked at: the
 *  point at view depth \`d\`, from the eye, is \`origin + d · along\` — along the ray scaled so that its
 *  forward component is 1; for an orthographic view along the forward, from the near plane's point
 *  moved onto the plane of the eye. */
struct FogCellRay{origin:vec3f,along:vec3f,}
fn fogCellRay(at:vec2f)->FogCellRay{
 let near=fogNearPoint(uvToNdc(at/frame.grid.xy));
 let forward=frame.forward.xyz;
 if(fogOrtho()){return FogCellRay(near-dot(near,forward)*forward,forward);}
 return FogCellRay(vec3f(0.0),near/dot(near,forward));
}
/** The point of the ray \`ray\` at view depth \`depth\`, from the eye. */
fn fogCellRayAt(ray:FogCellRay,depth:f32)->vec3f{return ray.origin+depth*ray.along;}
/** The cell's point (xyz) and its view depth (w), at \`offset\` within it: along the ray through its pixel,
 *  its forward component \`depth\`; for an orthographic view the near plane's point moved to that depth. */
fn fogCellPoint(cell:vec3u,offset:vec3f)->vec4f{
 let depth=fogDepthAtSlice(max(f32(cell.z)+offset.z,0.0));
 return vec4f(frame.eye.xyz+fogCellRayAt(fogCellRay(vec2f(cell.xy)+offset.xy),depth),depth);
}
`,
)

/**
 * WHERE A CELL'S SAMPLES LIE ON THE SURFACES, from the depth buffer alone: the sample's offset within its cell
 * moved forward off the surface behind it (\`fogLiftOffSurface\`), and the sample the image's jitter and the cell's
 * random numbers (\`fogRand\`) put it at (\`fogSampleOffset\`: sample \`s\` of the cell). The scatter takes its samples there,
 * and finds the sky's visibility (\`skyVisibilityWgsl.ts\`) of each. The program declares the frame and
 * the scene's depth (\`fogDepth\`).
 */
export const FOG_SURFACE_WGSL = wgslBlock(
  'FOG_SURFACE_WGSL',
  [FOG_CELLS_WGSL, ndcToUv, perspectiveDivide, rand4dPcg32],
  `
/** The view depth the depth buffer holds at \`pixel\`: its far value, where no surface was drawn, converts
 *  to \`1 / FOG_DEPTH_FUDGE\` (10¹¹ metres), the tiny fudge keeping the division finite; for an
 *  orthographic view, whose depth buffer is linear, to the far plane's. */
fn fogSceneDepthAt(pixel:vec2i)->f32{
 let at=clamp(pixel,vec2i(0),vec2i(frame.view.xy)-vec2i(1));
 let z=textureLoad(fogDepth,at,0);
 if(fogOrtho()){return (z-frame.depthMap.y)/frame.depthMap.x;}
 return frame.depthMap.y/(z-frame.depthMap.x+${wgslF32(FOG_DEPTH_FUDGE)}*frame.depthMap.y);
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
/** Three random numbers of the cell and the sample, each in [−1, 1]. */
fn fogRand(cell:vec3u,sample:u32)->vec3f{
 let v=rand4dPcg32(vec4i(vec3i(cell),i32(frame.frame.x+8u*sample)));
 return vec3f(v.xyz)/4294967295.0*2.0-1.0;
}
/** The offset within the cell of its sample \`s\`: the image's jitter and the cell's random shift, lifted off the surface. */
fn fogSampleOffset(cell:vec3u,s:u32)->vec3f{
 var jitter=frame.offsets[s].xyz;
 if(frame.tune.z>0.0){jitter+=frame.tune.z*fogRand(cell,s);}
 return fogLiftOffSurface(cell,jitter);
}`,
)

/** What the cells read of the local fog volumes (`localFogMedium`): read at the cell's sample, the
 *  distances of its front and back from the eye telling what the volumes' start distances cut; nothing
 *  where the run keeps them out of the volume. */
const LOCAL_MEDIUM_TEXT = `fn fogLocalMedium(cell:vec3u,offset:vec3f)->LocalFogMedium{
 if(!localFogFlagged(${LOCAL_FOG_FLAG.inVolume}u)||localFogCount()==0u){return LocalFogMedium(vec3f(0.0),0.0,vec3f(0.0));}
 let ray=fogCellRay(vec2f(cell.xy)+offset.xy);
 let at=fogCellRayAt(ray,fogDepthAtSlice(max(f32(cell.z)+offset.z,0.0)));
 let back=fogCellRayAt(ray,fogDepthAtSlice(f32(cell.z)+1.0));
 let front=fogCellRayAt(ray,fogDepthAtSlice(f32(cell.z)));
 return localFogMedium(at,fogViewDistance(back),fogViewDistance(front));
}
`

/** The cell's medium with what the local fog volumes add to it. */
const LOCAL_MEDIUM_ADDED = `
 let added=fogLocalMedium(cell,offset);
 scattering+=vec4f(added.scattering,added.extinction);
 if((flags&${FOG_VOLUME_FLAG.glow}u)!=0u){glow+=added.emissive;}`

const grids = new Map<boolean, ReturnType<typeof wgslBlock>>()

/** What the cells read of the scene: the depth buffer, the medium, the local fog volumes' unless `local` is
 *  false (the project switch `localFogVolumeSupport`): the grid then holds none of their code. */
export function fogGridWgsl(local: boolean) {
  let grid = grids.get(local)
  if (!grid) grids.set(local, (grid = gridBlock(local)))
  return grid
}

const gridBlock = (local: boolean) =>
  wgslBlock(
    `FOG_GRID_WGSL(${local})`,
    [FOG_SURFACE_WGSL, FOG_LAW_WGSL, ...(local ? [FOG_LOCAL_MEDIUM_WGSL] : []), FLOAT32_MAX],
    `
/** A density per metre in the per-centimetre unit the matched glow is written for. */
const FOG_DENSITY_PER_CENTIMETRE:f32=0.01;
/** The distance from the eye of the point at \`v\` from it: its length — along the forward for an
 *  orthographic view, whose rays are parallel. */
fn fogViewDistance(v:vec3f)->f32{
 let d=length(v);
 if(fogOrtho()){return d*d/dot(v,frame.forward.xyz);}
 return d;
}
${local ? LOCAL_MEDIUM_TEXT : ''}/** A cell's medium: what its particles scatter (xyz) and its extinction (w), per metre, and its
 *  own light. */
struct FogMedium{scattering:vec4f,glow:vec3f,}
fn fogMedium(cell:vec3u)->FogMedium{
 let offset=fogLiftOffSurface(cell,vec3f(0.5));
 let density=fogDensityAt(fogCellPoint(cell,offset).y)*FOG_HALF_DENSITY;
 let extinction=max(density*frame.medium.y,0.0);
 var glow=vec3f(0.0);
 var scattering=vec4f(frame.particleColor.rgb*extinction,extinction);
 let flags=u32(frame.medium.w);
 if((flags&${FOG_VOLUME_FLAG.glow}u)!=0u){
  glow=frame.glow.rgb;
  if((flags&${FOG_VOLUME_FLAG.matches}u)!=0u){glow*=density*FOG_DENSITY_PER_CENTIMETRE;}
 }${local ? LOCAL_MEDIUM_ADDED : ''}
 if((flags&${FOG_VOLUME_FLAG.voxels}u)!=0u){
  scattering+=textureLoad(fogVoxelIn,vec3i(cell),0);
  glow+=textureLoad(fogVoxelEmitIn,vec3i(cell),0).rgb;
 }
 return FogMedium(scattering,glow);
}
/** A value kept where it is positive and finite, zero where it is not (a NaN, an infinity, a negative). */
fn fogPositiveFinite(v:vec4f)->vec4f{
 return select(vec4f(0.0),v,(v>=vec4f(0.0))&(v<=vec4f(FLOAT32_MAX)));
}`,
  )
