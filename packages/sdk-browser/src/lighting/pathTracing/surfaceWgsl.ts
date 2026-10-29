import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { Frame3 } from '../../../../math/src/wgsl/basis.ts'
import { PT_FUZZ_WGSL } from './fuzzWgsl.ts'

/** The scatter types of a path (`PtSample.scatter`): the camera's ray before it has scattered, then what the first non-refractive bounce was. */
export const PT_SCATTER = { camera: 0, diffuse: 1, specular: 2, refract: 3, volume: 4 } as const

/** The scatter types as the shader names them. */
export const PT_SCATTER_WGSL = wgslBlock(
  'PT_SCATTER_WGSL',
  [],
  `const PT_SCATTER_CAMERA:u32=${PT_SCATTER.camera}u;
const PT_SCATTER_DIFFUSE:u32=${PT_SCATTER.diffuse}u;
const PT_SCATTER_SPECULAR:u32=${PT_SCATTER.specular}u;
const PT_SCATTER_REFRACT:u32=${PT_SCATTER.refract}u;
const PT_SCATTER_VOLUME:u32=${PT_SCATTER.volume}u;`,
)

/**
 * WHAT A HIT IS MADE OF AND WHAT THE BSDF KEEPS OF IT: `PtSurface` is the point, the geometric and shading normals and the normal interpolated between the triangle's vertices (`vertexNormal`, on the shading normal's side), the diffuse colour, the reflectance at normal incidence of the specular lobe, its roughness, the
 * emission, the cloth's fuzz (its amount and colour), the colour of the light a two-sided leaf passes through (`transmit`), the share of the rays it covers (`opacity`, one for an opaque surface), the index of refraction, whether the hit is a glass (a pick of the hit, see `ptHitSurface`), whether that glass is thin (its walls have no thickness: `thin`, with `tint`, the colour its medium gives a unit length), whether the ray met the front of the surface, and the
 * weight the pick put on the surface (one over the chance it had). `PtBsdf` is the surface fixed for a view direction (`ptPrepareBsdf`), `PtSample` what sampling it gives, `PtEval` what evaluating a
 * direction gives.
 */
export const PT_SURFACE_WGSL = wgslBlock(
  'PT_SURFACE_WGSL',
  [Frame3, PT_FUZZ_WGSL, PT_SCATTER_WGSL],
  `struct PtSurface{position:vec3f,geoNormal:vec3f,normal:vec3f,vertexNormal:vec3f,diffuse:vec3f,f0:vec3f,roughness:f32,emission:vec3f,hitT:f32,fuzzColor:vec3f,fuzz:f32,transmit:vec3f,opacity:f32,ior:f32,glass:bool,thin:bool,tint:vec3f,front:bool,selection:f32,}
struct PtBsdf{frame:Frame3,v:vec3f,alpha:f32,diffuseWeight:f32,f0:vec3f,f90:f32,specWeight:vec3f,diffuseProb:f32,specProb:f32,transmitProb:f32,fuzz:PtFuzz,eta:f32,glassEnergy:f32,glassProb:f32,alphaT:f32,specRW:f32,specTW:f32,thinCdf:vec3f,thinPdf:vec4f,}
struct PtSample{direction:vec3f,weight:vec3f,pdf:f32,positionBias:f32,roughness:f32,scatter:u32,}
struct PtEval{weight:vec3f,pdf:f32,}`,
)
