import { GROUND_SKY_RADIANCE, groundSkyMarch } from './captureWgsl.ts'
import { SKY_RAYS } from './layout.ts'
import { airProgram } from './programs.ts'
import { SKY_RAYS_COORDINATES_WGSL } from './skyRaysCoordinatesWgsl.ts'

/**
 * THE SKY BY DIRECTION: the radiance the air gives a ray along each direction above the horizon,
 * from the ground, in the scene's own axes — a table a ray that leaves the scene reads, whether it
 * is a bounce probe's or a reflection's, through the light buffer they all bind.
 *
 * It is a grid of `SKY_RAYS.azimuth` texels around the horizon and `SKY_RAYS.elevation` up it. The
 * elevation is spread by the square root of the direction's height, so the horizon, where the sky
 * changes fastest, is the finest. A reader blends the four texels around its direction, the azimuth
 * wrapping. The sun's disk is not in it: the sun is a light of its own.
 *
 * The builder is a thread a texel, the same march as the sky's capture (`groundSkyMarch`), run when
 * the air or the sun changes — never per image. A texel is the radiance in three half floats, kept
 * under what a half float holds.
 */

/** The builder, one thread a texel of the table, which it packs into the light buffer. */
export const SKY_RAYS_PROGRAM = airProgram(
  { air: 'read_write', transmittance: true, multiScatter: true },
  `
@compute @workgroup_size(8,8,1)
fn skyRaysMain(@builtin(global_invocation_id) id:vec3u){
 if(id.x>=SKY_RAYS_AZIMUTH||id.y>=SKY_RAYS_ELEVATION){return;}
 let dir=skyRaysDirection(id.xy);${groundSkyMarch(SKY_RAYS.altitudeKm)}
 let radiance=min(${GROUND_SKY_RADIANCE},vec3f(65000.0));
 air.skyRays[id.y*SKY_RAYS_AZIMUTH+id.x]=vec2u(pack2x16float(radiance.xy),pack2x16float(vec2f(radiance.z,0.0)));
}`,
  [SKY_RAYS_COORDINATES_WGSL],
)
