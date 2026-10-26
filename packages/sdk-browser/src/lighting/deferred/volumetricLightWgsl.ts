import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { IRRADIANCE_TERMS } from '../../../../sdk-core/src/scene/core/irradianceTerms.ts'
import { FULLSCREEN_VERTEX } from '../../gpu/shader/fullscreenTriangle.ts'
import { SURFACE_COLOUR_LAYERS, SURFACE_WORDS } from '../../materials/surface/surfaceOutputs.ts'
import { volumetricLightmapWgsl } from '../volumetricLightmap/sampleWgsl.ts'
import {
  COLOURS_BINDING_WGSL,
  DEPTH_BINDING_WGSL,
  VIEW_BINDING_WGSL,
  WORDS_BINDING_WGSL,
} from './litSurfaceWgsl.ts'
import { PIXEL_TILE_CLASS_WGSL } from './tileClass.ts'
import { WORLD_AT_WGSL } from './worldAtWgsl.ts'

/** The entry of the pass. */
export const VOLUMETRIC_LIGHT_ENTRY = 'volumetricLightMain'
/** The binding of the lightmap's view block in the pass; its other resources follow it (`volumetricLightmapWgsl`). */
export const VOLUMETRIC_LIGHT_FIRST = 70
/** The format of the light the pass leaves: the irradiance in `rgb`, one in `a` where the pixel was lit. */
export const VOLUMETRIC_LIGHT_FORMAT: GPUTextureFormat = 'rgba16float'

/** The cosine lobe's transfer of term `k` of the basis, the weight the lightmap's coefficient of the term is
 *  given along a normal `N` whose squares are `sq`: the basis function with its sign, times the factor that
 *  convolves its band with the cosine (π, 2π/3, π/4), all as the file writes them. */
const transfer = (k: number) => {
  const { basis, band, contract, polynomial } = IRRADIANCE_TERMS[k]
  return `${contract * (band / Math.abs(basis))}*(${polynomial('N', 'sq')})`
}
const terms = IRRADIANCE_TERMS.map((_, k) => transfer(k))

/**
 * THE LIGHT THE VOLUMETRIC LIGHTMAP GIVES THE PIXELS, a pass of its own: the lit passes have not a
 * sampled texture to spare for the nine of the lightmap (`sampleWgsl.ts`). A fullscreen draw reads each lit
 * pixel's point and normal, the third-order harmonics of the lightmap at that point
 * (`vlmSh3`), and leaves their irradiance along the normal — the harmonics dotted with the normal's cosine
 * transfer, never negative — in the texture the indirect pass reads (`DEFERRED_BINDINGS.volumetricLight`),
 * which lights the pixel's diffuse colour with it as it does the environment's. A pixel no light
 * reaches, the background and the unlit, is left black. A scene with no lightmap binds the black
 * one-texel textures (`textures.ts`) and the pass is not made.
 */
export const VOLUMETRIC_LIGHT_WGSL = wgslBlock(
  'VOLUMETRIC_LIGHT_WGSL',
  [
    COLOURS_BINDING_WGSL,
    WORDS_BINDING_WGSL,
    DEPTH_BINDING_WGSL,
    VIEW_BINDING_WGSL,
    WORLD_AT_WGSL,
    PIXEL_TILE_CLASS_WGSL,
    volumetricLightmapWgsl(0, VOLUMETRIC_LIGHT_FIRST),
    FULLSCREEN_VERTEX,
  ],
  `
fn volumetricIrradiance(sh:VlmSh3,N:vec3f)->vec3f{
 let sq=N*N;
 let low=vec4f(${terms.slice(0, 4).join(',')});
 let high=vec4f(${terms.slice(4, 8).join(',')});
 let top=${terms[8]};
 return max(vlmDotSh3(sh,low,high,top),vec3f(0.0));
}
@fragment fn ${VOLUMETRIC_LIGHT_ENTRY}(@builtin(position) pixel:vec4f)->@location(0) vec4f{
 let coord=vec2i(pixel.xy);
 if(pixelTileClass(textureLoad(words,coord,${SURFACE_WORDS.flags},0).r)==0u){return vec4f(0.0);}
 let N=normalize(textureLoad(colours,coord,${SURFACE_COLOUR_LAYERS.normal},0).xyz);
 let P=worldAt(pixel.xy,textureLoad(depth,coord,0));
 return vec4f(volumetricIrradiance(vlmSh3(vlmBrickUvs(P)),N),1.0);
}`,
)
