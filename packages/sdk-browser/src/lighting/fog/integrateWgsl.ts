import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { FOG_CELLS_WGSL } from './gridWgsl.ts'

/**
 * THE CONSERVATIVE DEPTH: for each cell of the grid across the image, the furthest depth of the
 * surfaces its pixels show — and half a cell around them —, so that a cell wholly behind them is
 * not lit (`./scatterWgsl.ts`). One thread a cell (`furthestMain`); the depth is the device's,
 * reverse-Z, so the furthest is the least.
 *
 * It is read from the depth pyramid the frame builds before the volume (`visibility/hiz/gpu/`):
 * the farthest layer of the finished opaque depth (`hizCellFarthest`), built in this image after the
 * raster's rest pass and the transparents' front pass (`encodeDepthPyramid`) — none of it the last
 * image's, none unfinished —; where the transparents' front is folded into it, the host gives the
 * volume no pyramid and no cell is held hidden (`opaquePyramidOf`). The rectangle is the cell's
 * pixels and half a cell each side of them (the footprint's margin), the pixels it covers by their
 * centres are the footprint, and the footprint is taken at the level of the pyramid at which four
 * texels cover it, the least depth over them. The pyramid's level 1 is half the image, the first
 * level of the pyramid the footprint's levels are counted from: its level `l + 1` is the
 * footprint's level `l`.
 * The level is the least where four texels reach: the highest bit of the footprint's width less
 * the one the four hold, one more where the footprint's alignment to the texels needs it.
 */
export const FOG_FURTHEST_WGSL = wgslBlock(
  'FOG_FURTHEST_WGSL',
  [],
  `
/** The level at which four texels of the pyramid cover the footprint \`texels\` (x0, y0, x1, y1, inclusive). */
fn fogPyramidLevel(texels:vec4i)->i32{
 let size=texels.zw-texels.xy;
 let level=max(max(firstLeadingBit(size.x),firstLeadingBit(size.y))-1,0);
 let more=any((texels.zw>>vec2u(u32(level)))-(texels.xy>>vec2u(u32(level)))>vec2i(3));
 return level+select(0,1,more);
}
@compute @workgroup_size(8,8,1)
fn furthestMain(@builtin(global_invocation_id) id:vec3u){
 if(any(id.xy>=vec2u(frame.grid.xy))){return;}
 let view=frame.view.xy;
 // The cell's pixels and half a cell around them, as device coordinates, then as pixel centres.
 let tile=frame.grid.w*frame.view.zw*vec2f(2.0,-2.0);
 let a=(vec2f(id.xy)-0.5)*tile+vec2f(-1.0,1.0);
 let b=(vec2f(id.xy)+1.5)*tile+vec2f(-1.0,1.0);
 let low=min(a,b);let high=max(a,b);
 let uv=saturate(vec4f(low.x,high.y,high.x,low.y)*vec4f(0.5,-0.5,0.5,-0.5)+0.5);
 var pixels=vec4i(uv*view.xyxy+vec4f(0.5,0.5,-0.5,-0.5));
 pixels=vec4i(max(pixels.xy,vec2i(0)),min(pixels.zw,vec2i(view)-vec2i(1)));
 // The footprint in the first level's texels (two pixels a side), then at the level four texels cover.
 var texels=vec4i(pixels.xy,max(pixels.xy,pixels.zw))>>vec4u(1u);
 let level=fogPyramidLevel(texels);
 texels=texels>>vec4u(u32(level));
 // Our pyramid's level 1 is the footprint's level 0; where the pyramid has no level that high the
 // image is too small to hold the footprint, and nothing is held behind.
 let at=level+1;
 var furthest=0.0;
 if(at<hizLevelCount()){
  furthest=1.0;
  for(var y=texels.y;y<=texels.w;y++){
   for(var x=texels.x;x<=texels.z;x++){furthest=min(furthest,hizCellFarthest(vec2i(x,y),at));}
  }
 }
 textureStore(fogFurthestOut,vec2i(id.xy),vec4f(furthest,0.0,0.0,0.0));
}`,
)

/**
 * THE INTEGRATION: the volume of a cell summed front to back along its column, so that a cell holds
 * the light scattered toward the eye by every cell in front of it and the share of the light that
 * crosses all of them. One thread a column of cells (`integrateMain`); the cells walk from the
 * first slice, each step the distance between the centres of two slices.
 *
 * A cell of extinction \`e\` and scattering \`s\` over a step \`d\` gives, by the integral of its light
 * over the step — \`(s − s · exp(−e·d)) / e\`, which conserves energy where the plain product with
 * \`d\` does not —, times the transmittance in front of it, the divisor held to a thousandth per metre
 * where the extinction is thinner, as the engines hold theirs; its transmittance is \`exp(−e·d)\`. Both
 * are faded in from the eye over the near fade-in distance (\`frame.medium.z\`, the inverse): the
 * first metres of the volume weigh in as the distance travelled grows. The result holds, for each
 * cell, the light and the transmittance from the eye to its far side.
 */
export const FOG_INTEGRATE_WGSL = wgslBlock(
  'FOG_INTEGRATE_WGSL',
  [FOG_CELLS_WGSL],
  `
/** The least extinction a cell's integral is divided by, per metre: the engines' 10⁻⁵ per centimetre. */
const FOG_MIN_EXTINCTION:f32=0.001;
@compute @workgroup_size(8,8,1)
fn integrateMain(@builtin(global_invocation_id) id:vec3u){
 if(any(id.xy>=vec2u(frame.grid.xy))){return;}
 var light=vec3f(0.0);
 var kept=1.0;
 var before=fogCellPoint(vec3u(id.xy,0u),vec3f(0.5,0.5,0.0)).xyz;
 var travelled=0.0;
 for(var layer=0u;layer<u32(frame.grid.z);layer++){
  let cell=vec3u(id.xy,layer);
  let s=textureLoad(fogScatterIn,vec3i(cell),0);
  let here=fogCellPoint(cell,vec3f(0.5)).xyz;
  let step=length(here-before);
  before=here;
  let through=exp(-s.w*step);
  travelled+=step;
  let fade=saturate(travelled*frame.medium.z);
  light+=fade*(s.rgb-s.rgb*through)/max(s.w,FOG_MIN_EXTINCTION)*kept;
  kept*=mix(1.0,through,fade);
  textureStore(fogIntegrated,vec3i(cell),vec4f(light,kept));
 }
}`,
)
