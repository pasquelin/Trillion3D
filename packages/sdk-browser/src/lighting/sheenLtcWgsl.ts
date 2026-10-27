import { wgslConst, wgslFn } from '../../../math/src/wgsl/decl.ts'
import { wgslF32 } from '../../../math/src/wgsl/number.ts'
import { bilinear4 } from '../../../math/src/wgsl/sampling.ts'
import {
  SHEEN_LTC_ALBEDO_ALONG_NORMAL,
  SHEEN_LTC_SIZE,
} from '../../../sdk-core/src/lighting/sheenLtc.ts'

/**
 * THE SHEEN LOBE'S TABLE ON THE GPU (`sheenLtc.ts` holds the data): the light buffer holds it (`DirectLights.sheen`, written once
 * with the buffer, `frame/backend/state/lightBuffer.ts`), as it holds the rectangles' fitted lobe and the environment BRDF, so a
 * program that lights a cloth spends no sampled texture and no sampler on it: a texel is two words of four half floats.
 *
 * `sheenLtcCoefficients` returns the texel `(aInv, bInv, albedo, 0)` for a view of cosine `NoV` on a fuzz of perceptual
 * roughness `roughness`: the table read at `(sqrt(roughness), saturate(|NoV| + 1e-5))` times 31, the first and the last texels'
 * centres at 0 and 1, bilinear between the four texels around and held to the edge, as a bilinear sampler clamped to the edge
 * reads a texture at the texel-centre transform. `sheenLtcAlbedo` is its third channel, the directional albedo; `sheenLtcTexel`
 * the texel at column `x` and row `y`.
 */
export const sheenLtcTexel = wgslFn(
  'sheenLtcTexel',
  [],
  `fn sheenLtcTexel(x:u32,y:u32)->vec4f{
 let w=directLights.sheen[y*${SHEEN_LTC_SIZE}u+x];
 return vec4f(unpack2x16float(w.x),unpack2x16float(w.y));
}`,
)

export const sheenLtcCoefficients = wgslFn(
  'sheenLtcCoefficients',
  [sheenLtcTexel, bilinear4],
  `fn sheenLtcCoefficients(NoV:f32,roughness:f32)->vec4f{
 let at=clamp(vec2f(sqrt(roughness),saturate(abs(NoV)+1e-5)),vec2f(0.0),vec2f(1.0))*${SHEEN_LTC_SIZE - 1}.0;
 let i=min(vec2u(at),vec2u(${SHEEN_LTC_SIZE - 2}u));let f=at-vec2f(i);
 return bilinear4(sheenLtcTexel(i.x,i.y),sheenLtcTexel(i.x+1u,i.y),sheenLtcTexel(i.x,i.y+1u),sheenLtcTexel(i.x+1u,i.y+1u),f);
}`,
)

/** The directional albedo of the sheen lobe at (`NoV`, `roughness`): the third channel of `sheenLtcCoefficients`. */
export const sheenLtcAlbedo = wgslFn(
  'sheenLtcAlbedo',
  [sheenLtcCoefficients],
  `fn sheenLtcAlbedo(NoV:f32,roughness:f32)->f32{
 return sheenLtcCoefficients(NoV,roughness).z;
}`,
)

/** The directional albedo of the table's last row (`SHEEN_LTC_ALBEDO_ALONG_NORMAL`), a view along the normal, as 32-bit floats. */
const sheenLtcAlongNormalTable = wgslConst(
  'SHEEN_LTC_ALBEDO_ALONG_NORMAL',
  [],
  `const SHEEN_LTC_ALBEDO_ALONG_NORMAL=array<f32,${SHEEN_LTC_SIZE}>(${Array.from(SHEEN_LTC_ALBEDO_ALONG_NORMAL, wgslF32).join(',')});`,
)

/**
 * The directional albedo of the sheen lobe for a view along the normal (`NoV` of one), read from the row above as the bilinear
 * table reads `sheenLtcAlbedo` there: between the two texel centres around `sqrt(roughness) * 31`, held to the edge. For a
 * pass that binds no light buffer and sees every surface along its normal.
 */
export const sheenLtcAlbedoAlongNormal = wgslFn(
  'sheenLtcAlbedoAlongNormal',
  [sheenLtcAlongNormalTable],
  `fn sheenLtcAlbedoAlongNormal(roughness:f32)->f32{
 let column=clamp(sqrt(roughness),0.0,1.0)*${SHEEN_LTC_SIZE - 1}.0;
 let low=u32(floor(column));
 return mix(SHEEN_LTC_ALBEDO_ALONG_NORMAL[low],SHEEN_LTC_ALBEDO_ALONG_NORMAL[min(low+1u,${SHEEN_LTC_SIZE - 1}u)],column-floor(column));
}`,
)
