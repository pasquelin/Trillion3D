import { TILE_READ_WGSL } from '../../texture/samplingFootprint.ts'
import {
  WRAP_S_MIRROR,
  WRAP_S_REPEAT,
  WRAP_T_MIRROR,
  WRAP_T_REPEAT,
} from '../../visibility/wrapModes.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'

/**
 * The shader side of a texture's sampling words (`sampling.ts`), inside `TILE_POOL_WGSL`
 * (`wgsl.ts`). A page none of whose maps has a filter word never runs it: its reads are the
 * default one (`slotLod`, `atlasReadWgsl`). Otherwise the UV transform maps the
 * coordinate and its derivatives first, so level, seam and tile are those of the transformed
 * coordinate; the filter word then picks the level and whether a level is read at the centre of
 * its texel or mixed by the sampler. Anisotropy averages `taps` reads along the longer axis of
 * the footprint, each over its share of it — once when it is hardly elongated
 * (`ANISOTROPY_SLACK`), otherwise as many as the ratio, which the grant — 16 at most, the 4-bit
 * field of the sampling word (`MAX_ANISOTROPY`) — bounds: no footprint within the grant is read
 * with fewer taps than it is stretched. `tapOffset` places tap `i` of `n` on that line, for
 * the read and for the request alike.
 */
export const SAMPLING_WGSL = wgslBlock(
  'SAMPLING_WGSL',
  [TILE_READ_WGSL],
  `/** The centre of the texel a coordinate falls in, for a nearest read; the coordinate otherwise. */
fn pickTexel(texel:vec2f,nearest:bool)->vec2f{return select(texel,floor(texel)+0.5,nearest);}
/** One axis of a tap line folded once (\`foldLine\`): the folded centre, the direction the taps run
 *  in the folded period, and 1 when the whole line, \`reach\` around its centre, stays in one period. */
fn foldAxis(t:f32,reach:f32,repeat:bool,mirror:bool)->vec3f{
 if(!repeat&&!mirror){return vec3f(t,1.0,select(0.0,1.0,t-reach>=0.0&&t+reach<=1.0));}
 let k=floor(t);
 let odd=mirror&&k-2.0*floor(k*0.5)>0.5;
 let inside=floor(t-reach)==k&&floor(t+reach)==k;
 return vec3f(select(t-k,1.0-(t-k),odd),select(1.0,-1.0,odd),select(0.0,1.0,inside));
}
/** A tap line folded once by its addressing: \`dir.x\` zero when it leaves its period or meets a
 *  seam, where each tap folds itself. The line reaches half a texel past its ends; on a repeating
 *  axis, half a texel of \`seam\`, the coarsest level the read mixes, whose seam is the widest. */
struct FoldedLine{uv:vec2f,dir:vec2f,}
fn foldLine(r:TileRead,wrap:u32,size:vec2f,seam:vec2f)->FoldedLine{
 let half=abs(r.axis)*0.5;
 let reach=select(half+0.5/size,half+0.5/seam,vec2<bool>((wrap&${WRAP_S_REPEAT}u)!=0u,(wrap&${WRAP_T_REPEAT}u)!=0u));
 let x=foldAxis(r.uv.x,reach.x,(wrap&${WRAP_S_REPEAT}u)!=0u,(wrap&${WRAP_S_MIRROR}u)!=0u);
 let y=foldAxis(r.uv.y,reach.y,(wrap&${WRAP_T_REPEAT}u)!=0u,(wrap&${WRAP_T_MIRROR}u)!=0u);
 return FoldedLine(vec2f(x.x,y.x),vec2f(x.y,y.y)*x.z*y.z);
}`,
)
