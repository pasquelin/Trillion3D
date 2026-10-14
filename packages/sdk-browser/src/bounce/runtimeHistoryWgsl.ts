import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { wgslConsts } from '../../../math/src/wgsl/consts.ts'
import { wgslF32 } from '../../../math/src/wgsl/number.ts'
import { clipToFramebuffer } from '../../../math/src/wgsl/projection.ts'
import { runtimeCellWgsl } from './runtimeCellWgsl.ts'
import { STORE_MODE } from './runtimeLayout.ts'

/** The least cosine between a cell's normal and the surface's for the cell to hold it: 60°, past
 *  what a normal map bends a face by, short of the right angle of two faces of a corner. */
const NORMAL_MATCH = 0.5
/** The least cosine of a surface to the eye the depth's reach is taken at: a grazing surface's
 *  depth steps up to twenty pixels' width a pixel. */
const GRAZING = 0.05
/** The depth's share a key's two halves and a pixel's rounding may move it by: four steps of a half. */
const DEPTH_SHARE = 2e-3
/** The widest lobe a history is taken at its virtual point for, as the tangent of its cone (`rtAnswer`). */
const SMOOTH = 0.25

/**
 * THE HISTORY OF A PIXEL'S SURFACE in the run-time proxy's store (`runtimeLayout.ts`): what answers a
 * pixel the frame's budget leaves out (`rtAnswer`). A still view (`STORE_MODE.inPlace`) reads the
 * pixel's own cell. A moving one reads the set the image before wrote, at the pixel the view of the
 * radiance pyramid — that image's, jitter and size included (`ReflectionView.radianceViewProj`,
 * `radiance.xy`) — saw the surface at (`rtSurfaceHistory`); and, on a smooth surface under a
 * perspective, at the pixel that saw the reflected hit's virtual point, `P − V·t` behind the surface
 * (`rtVirtualHistory`), so that a mirror's reflection moves with its parallax, not with the mirror.
 * A cell holds the surface when its normal is the surface's and its depth the surface's within a
 * pixel's step at its slope (`rtHolds`); a virtual cell when it lies on the surface's plane and its
 * ray is as long. None holds it: a hole, which the chain's next stage answers until a ray is cast.
 *
 * Cost, a pixel, against the frame's rays (`FRAME_WORK`): still, one cell read (twelve bytes); moving,
 * at most two cells read and one written (36 bytes) and three projections. Worst case at 1920×1080,
 * every pixel a smooth moving surface: 75 MB, about 0.75 ms at 100 GB/s; the cells read follow the
 * pixels, neighbours reading neighbours.
 */
export const runtimeHistoryWgsl = (group: number, store: number) =>
  wgslBlock(
    `runtimeHistoryWgsl(${group}, ${store})`,
    [runtimeCellWgsl(group, store), clipToFramebuffer],
    `
${wgslConsts({ RT_IN_PLACE: STORE_MODE.inPlace, RT_REPROJECT: STORE_MODE.reproject })}
const RT_NORMAL_MATCH:f32=${wgslF32(NORMAL_MATCH)};
const RT_GRAZING:f32=${wgslF32(GRAZING)};
const RT_DEPTH_SHARE:f32=${wgslF32(DEPTH_SHARE)};
const RT_SMOOTH:f32=${wgslF32(SMOOTH)};
/** A clip point's linear depth: its \`w\` under a perspective, its depth in metres under an orthographic
 *  projection (\`ReflectionView.slab\`). */
fn rtDepthOf(clip:vec4f)->f32{
 if(reflectionView.slab.w!=0.0){return clip.w;}
 return clip.z*reflectionView.slab.x/reflectionView.slab.z;
}
/** The surface's key depth in this image's view. */
fn rtKeyDepth(P:vec3f)->f32{return rtDepthOf(reflectionView.viewProj*vec4f(P,1.0));}
/** How far a cell's depth may lie from a surface's at \`depth\`, of normal \`N\` seen along \`V\`: a
 *  pixel's step along its slope, once for the rounding of the pixel and twice for the jitter, and the
 *  halves' rounding. */
fn rtDepthReach(depth:f32,N:vec3f,V:vec3f)->f32{
 let c=max(abs(dot(N,V)),RT_GRAZING);
 var pixel=reflectionView.slab.x;
 if(reflectionView.slab.w!=0.0){pixel*=depth;}
 return pixel*(1.0+2.0*sqrt(1.0-c*c)/c)+RT_DEPTH_SHARE*depth;
}
/** Whether \`cell\` holds the surface at \`depth\`, of normal \`N\`, seen along \`V\`. */
fn rtHolds(cell:RtCell,depth:f32,N:vec3f,V:vec3f)->bool{
 return cell.stamp!=0u&&dot(cell.normal,N)>=RT_NORMAL_MATCH&&abs(cell.depth-depth)<=rtDepthReach(depth,N,V);
}
/** The cell the image before wrote where its view saw \`clip\`: none off that image. */
fn rtPreviousCell(clip:vec4f)->RtCell{
 if(!(clip.w>0.0)){return rtNone();}
 let size=reflectionView.radiance.xy;
 let at=floor(clipToFramebuffer(clip,size).xy);
 if(any(at<vec2f(0.0))||any(at>=size)){return rtNone();}
 return rtCellRead(vec2u(at),reflectionView.runtime.y);
}
fn rtSurfaceHistory(P:vec3f,N:vec3f,V:vec3f)->RtCell{
 let clip=reflectionView.radianceViewProj*vec4f(P,1.0);
 let cell=rtPreviousCell(clip);
 if(!rtHolds(cell,rtDepthOf(clip),N,V)){return rtNone();}
 return cell;
}
/** The cell that saw, the image before, what \`P\`'s ray meets \`held.distance\` away: the one at the
 *  virtual point \`Pv\`, its surface \`X\` on the ray from that image's eye through \`Pv\`, on \`P\`'s plane,
 *  its ray as long as \`Pv\` lies behind it. */
fn rtVirtualHistory(P:vec3f,N:vec3f,V:vec3f,held:RtCell)->RtCell{
 let Pv=P-V*held.distance;
 let clip=reflectionView.radianceViewProj*vec4f(Pv,1.0);
 let cell=rtPreviousCell(clip);
 if(cell.stamp==0u||dot(cell.normal,N)<RT_NORMAL_MATCH){return rtNone();}
 let e=reflectionView.radianceInverse[2];
 let eye=e.xyz/e.w;
 let X=eye+(Pv-eye)*(cell.depth/clip.w);
 let along=distance(Pv,eye);
 let reach=rtDepthReach(cell.depth,N,normalize(eye-X))+RT_DEPTH_SHARE*along;
 if(abs(dot(X-P,N))>reach||abs(distance(X,eye)+cell.distance-along)>reach){return rtNone();}
 return cell;
}
/** The history of the surface at \`P\`, of normal \`N\`, a lobe of cone \`tangent\`: \`own\`, the pixel's own
 *  cell, in a still view; none — a hole — where no cell holds it. */
fn rtHistory(own:RtCell,P:vec3f,N:vec3f,tangent:f32)->RtCell{
 let V=viewToEye(P);
 let mode=reflectionView.runtime.w;
 if(mode==RT_IN_PLACE){
  if(rtHolds(own,rtKeyDepth(P),N,V)){return own;}
  return rtNone();
 }
 if(mode!=RT_REPROJECT){return rtNone();}
 let held=rtSurfaceHistory(P,N,V);
 if(held.share==0u||!(held.distance>0.0)||tangent>RT_SMOOTH||reflectionView.slab.w==0.0){return held;}
 let seen=rtVirtualHistory(P,N,V,held);
 if(seen.stamp==0u){return held;}
 return seen;
}
`,
  )
