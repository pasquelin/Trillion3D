import type { ContractKey } from './contractCuts.ts'
import { type FusedBlend } from '../../post/effects/webgpuKinds.ts'
import type { FogRead } from '../fog/read.ts'
import type { SkyLightReadSet } from '../../modules/sky/skyLight/read.ts'
import type { CloudShadowSet } from '../atmosphere/cloudShadowRead.ts'
import type { ToneLut } from '../toneLut.ts'
import type { VolumetricLightmapGpu } from '../volumetricLightmap/gpu.ts'
import type { DeferredPlaceholders } from './setup.ts'

/** Direct-lighting contract resources the pass rereads; when absent, they are replaced. With them,
 *  the frame's key: what its program leaves out (`contractCuts.ts`). */
export interface DirectLightResources extends Partial<ContractKey> {
  /** The declared lights, grown with the scene: the one buffer a contract program reads them from. */
  lights?: GPUBuffer
  tiles?: GPUBuffer
  /** How many directional lights and how many local lights the light buffer holds this image: the
   *  pass of a kind that has none is not drawn. Absent, both are. */
  suns?: number
  locals?: number
  /** The ranks of the directional lights in the light buffer, after their count: what the sun's pass walks
   *  (`frame/backend/state/lightBuffer.ts`); absent, the stand-in of no sun. */
  sunRanks?: GPUBuffer
  /** The virtual shadow maps a blend pass's fragments trace (`vsmTraceFactor`): this frame's page
   *  table, projection data and uniforms, the pool's first slice, and the projection's view and
   *  blue noise. */
  vsm?: {
    pageTable: GPUBuffer
    projectionData: GPUBuffer
    uniforms: GPUBuffer
    pool: GPUBuffer
    view: GPUBuffer
    noise: GPUTextureView
  }
  /** The virtual shadow maps' local lights' mask (`vsmEncode.ts`), a texel a pixel, four bits a light
   *  of the pixel's cell: bound at `DEFERRED_BINDINGS.vsmMask`. */
  vsmMask?: GPUTextureView
  /** The shadowed lights of each cell of the light grid (`lightGridWgsl.ts`) the local lights' mask holds
   *  the lanes of: bound at `DEFERRED_BINDINGS.vsmLightGrid`. */
  vsmLightGrid?: GPUBuffer
  /** The suns' mask, a layer a sun (`vsmSunFactor`): bound at `DEFERRED_BINDINGS.vsmSunMask`. */
  vsmSunMask?: GPUTextureView
  /** The sun's distance-field shadow (`../distanceField/shadow/state.ts`): a byte a lane of the suns
   *  in a word a pixel, the opaque lit passes'; none where the image drew none. */
  farShadowMask?: GPUBuffer
  /** The probes' levels' uniform (`../bounce/uniform.ts`): one lifetime, the probes' identity; its presence says the frame is lit with
   *  the bounce program, the reflections read the scene's reach in it. */
  bounceGrid?: GPUBuffer
  /** What the light functions are read from this image (`../lightFunction/frame.ts`): the atlas and
   *  its table; absent, the stand-in, which answers no light function. */
  lightFunction?: GPUTextureView
  /** The reflection target the opaque trace wrote (`../reflections/trace/trace.ts`); absent, a zero
   *  substitute. */
  reflection?: GPUTextureView
  /** What the sky light is read with this image (`SkyLightReadSet`); absent, the stand-in that gives no
   *  light. */
  sky?: SkyLightReadSet
  /** The clouds' shade this image (`CloudShadowSet`); absent, the stand-in that casts none. */
  cloudShadow?: CloudShadowSet
  /** What the fog's read is bound to this image (`FogRead`): its cubemap, the volume the image
   *  built and the frame that maps a point to its cell; absent, their stand-ins. */
  fog?: FogRead
  /** The volume of the haze this image built (`../atmosphere/resources.ts`), a 3D texture the fog pass
   *  samples (`hazeSampledWgsl`); absent, the stand-in. */
  haze?: GPUTextureView
  /** The light shafts' occlusion mask the fog's inscattering is multiplied by this image
   *  (`../../modules/sky/lightShafts/frame.ts`); absent, the white stand-in. */
  lightShaft?: GPUTextureView
  /** What the screen probes left of the pixels' indirect light this image (`../bounce/screen/indirectWgsl.ts`): the
   *  history they keep, a texture the bounce program reads by load; absent, the stand-in that says none ran. */
  screenIndirect?: GPUTextureView
  /** The screen-space ambient occlusion this image drew (`../ao/frame.ts`): a texture of one byte a pixel the opaque
   *  resolve reads by load, where its view's word says to apply it; absent, the stand-in. */
  ambientOcclusion?: GPUTextureView
  /** The sky light's distance-field occlusion this image drew (`../distanceField/ao/`): the bent normals and depths packed
   *  in a buffer, and the uniform that describes them. Present, the indirect pass's program holding the code that applies it lights
   *  the image (`contractVariants.ts`); absent, the stand-ins and the program without it. */
  skyShadowing?: { bent: GPUBuffer; params: GPUBuffer }
  /** The volumetric lightmap on the GPU, where the scene has one and the image reads it
   *  (`../volumetricLightmap/frame.ts`): what the pass that gathers its light is bound to; absent, no light
   *  is gathered. */
  volumetricLightmap?: VolumetricLightmapGpu
  /** The light that pass left on the pixels this image (`volumetricLightPass.ts`), which the indirect pass
   *  reads by load; written by the lighting itself (`lightPass`), absent, the stand-in. */
  volumetricLight?: GPUTextureView
}
/** What composition reads: a colour; the glow the effect chain's last bloom left to it, with the
 *  dirt mask and the share of the image's light it keeps (`FusedBlend`), and the group that
 *  finishes the image with it (`../../post/finish/frame.ts`) — none where the image is shown as it
 *  is. A debug view's as-is pixels are read from the surfaces apart (`shaders.ts`). */
export type ComposedImage = {
  color: GPUTextureView
  glow?: FusedBlend
  finish?: GPUBindGroup
}
/** What the temporal pass resolves: the colour, the filtering layers, and,
 *  where it brought a larger history down to the display's size, the half-size image it wrote beside
 *  the colour. */
export type AccumulatedImage = Required<Omit<ComposedImage, 'glow' | 'finish'>> & {
  filter?: readonly [GPUTextureView, GPUTextureView]
  half?: GPUTextureView
}
export interface DeferredBindings {
  uniform: GPUBuffer
  placeholders: DeferredPlaceholders
  /** The tone table the lit compositions read (`../toneLut.ts`); none for a program that has no lit
   *  composition. */
  tone?: ToneLut
}
