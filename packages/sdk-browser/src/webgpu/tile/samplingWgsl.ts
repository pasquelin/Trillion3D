import { TILE_READ_WGSL } from '../../texture/samplingFootprint.ts'
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
fn pickTexel(texel:vec2f,nearest:bool)->vec2f{return select(texel,floor(texel)+0.5,nearest);}`,
)
