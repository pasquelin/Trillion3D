import { wgslBlock, type WgslDecl } from '../../../math/src/wgsl/decl.ts'
import { BLEND_BINDINGS, BLEND_CLOUD_FOG_BINDINGS } from '../gpu/bind/bindLayout.ts'
import { hvCameraReadWgsl } from '../lighting/heterogeneousVolumes/cameraReadWgsl.ts'
import {
  CLOUD_FOG_MODEL_BIT,
  MODEL_SHIFT,
  cloudFogModel,
  fogFreeModel,
} from '../materials/surface/surfaceModelWord.ts'
import { cloudFogReadWgsl } from '../modules/sky/clouds/translucentRead.ts'
import { blendLit } from './shaderSurface.ts'
import { allocateExtras, extraRead, extraWrite, type ExtraAsk } from './vertexExtras.ts'
import { MATERIAL_FLAG } from '../materials/table/materialLayout.ts'
import { materialFlagOf } from './vertexReadsWgsl.ts'

/**
 * WHAT THE BLEND STAGES WRITE AND READ PER VERTEX: the fog of the blended surfaces, and, for a program that
 * reads the clouds (`clouds`: the project switch `cloudShadowOnTranslucent` is on, or the scene holds
 * a surface whose material has `cloudFog`), the clouds' shade and layer. The vertex stage works the values
 * out and hands them over as extras (`vertexExtras.ts`), no lane of another value borrowed. A program takes the
 * fog per vertex (`fog`: the scene holds a surface whose fog is neither per pixel nor opted out, `fogVertexOf`) or
 * has the fragment work every fog out, its `fogVertexed` then the constant false and no lane spent on it:
 * - `fogLayer`, four lanes, where either is read: the fog a surface is seen through that does not depend on the
 *   pixel, laid from the farthest layer to the nearest — the height fog or the distance fog with the haze of the
 *   air behind it (`fogLaidFar`, `../lighting/fogCompose.ts`), the local fog volumes of the tile the vertex lies in
 *   over them (`fogLocalVertex`), the clouds over both — for a material whose fog is per vertex (not
 *   `computeFogPerPixel`, not single-layer water, not fog-free); the fragment stage lays the fog's volume, read in
 *   every pixel, over it (`fogVolumeOver`). For a material whose fog is per pixel, the cloud layer alone
 *   (`cloudFogOver`), which the fragment lays over the fog it works out; none for a fog-free one;
 * - `shade`, one lane, with the clouds: the share the clouds let the forward directional light through at the
 *   vertex (`cloudShadeAt`, `../lighting/atmosphere/cloudShadowRead.ts`), worked out for a lit surface alone, which the
 *   fragment stage gives to that light alone (`cloudShadeVertex`); the cloud layer is `cloudFogOver`,
 *   `../modules/sky/clouds/translucentRead.ts`.
 * Which of the two fogs a surface takes is read in the fragment from its material record (`materialFlagOf`). A feature that is off
 * gives its neutral value (the shade 1, the layer `(0, 0, 0, 1)`: the stand-in bound in its place,
 * `cloudVertex.ts`), so one program serves both. The vertex stage's output holds thirteen locations in a
 * program that reads neither, fourteen with the fog per vertex alone (one extra), fifteen with the clouds (two extras), and the front-face flag
 * besides: at most the sixteen WebGPU guarantees.
 */
export interface VertexReads {
  /** The program reads the clouds per vertex: the shade and the cloud image. */
  readonly clouds: boolean
  /** The program lays the fog of the surfaces whose fog is per vertex in the vertex stage (`fogVertexOf`). */
  readonly fog: boolean
}

/** The program reads neither: the fog is worked out for each pixel and no lane is spent on it. */
export const NO_VERTEX_READS: VertexReads = { clouds: false, fog: false }

export interface CloudVertexText {
  /** Its place in the name of a block built for it: empty without the vertex stage's words. */
  readonly key: string
  /** What the vertex stage's block declares for it, the fragment stages reading it. */
  readonly declared: readonly WgslDecl[]
  /** The extras the vertex stage's output holds, by member (`allocateExtras`). */
  readonly extras: readonly string[]
  /** The statements the vertex stage runs once the vertex has its place: the values into the extras. */
  readonly vertexLanes: string
  /** The statement every fragment entry begins with, taking the shade its vertices gave it
   *  (`cloudShadeVertex`); none without the clouds. */
  readonly entry: string
  /** The statements a fragment runs after it has laid its fog: the cloud layer over it, where the vertices
   *  have not laid it already; none without the clouds. */
  readonly apply: string
  /** The statements a thin layer runs on its `fog` (a `vec4f`): the cloud layer over it, as `apply`; none
   *  without the clouds. */
  readonly cloudOver: string
  /** The stage's `words` hold a fourth word, the order of the fragment's primitive in the pass (`withOitOrder`); false without it. */
  readonly ordered?: boolean
}

/** What the vertex stage hands over beside the fog: nothing, a stage that reads no fog (the front stage). */
export const NO_VERTEX_WORDS: CloudVertexText = {
  key: '',
  declared: [],
  extras: [],
  vertexLanes: '',
  entry: '',
  apply: '',
  cloudOver: '',
}

/** The cloud layer in a fragment: its light and its transmittance as the vertices gave them; laid
 *  over the fog it is `rgb * a + light`. */
const cloudFogFragment = (layer: string) =>
  wgslBlock(
    'CLOUD_FOG_FRAGMENT',
    [],
    `fn cloudFogLayer(v:VSOut)->vec4f{return ${layer};}
fn cloudFogged(rgb:vec3f,v:VSOut)->vec3f{
 let layer=cloudFogLayer(v);
 return rgb*layer.a+layer.rgb;
}`,
  )

/** The heterogeneous volumes composited with the translucency lie between the camera and the layer: where this image made their camera map
 *  (`BlendView.volumeCamera`), the fog is the volumes' radiance and transmittance over it (`hvCameraFog`, `cameraReadWgsl.ts`). */
const VOLUME_CAMERA_FOG = wgslBlock(
  'VOLUME_CAMERA_FOG',
  [hvCameraReadWgsl(BLEND_BINDINGS.volumeCamera)],
  `fn blendVolumeFog(in:VSOut,fog:vec4f)->vec4f{
 if(uni.volumeCamera==0u){return fog;}
 return hvCameraFog(fog,in.view,uni.eye.xyz,in.position.xy,uni.volumeCameraFactor,uni.preExposure);
}`,
)

/** The fog a blended fragment is seen through, whole (`blendFog`): the one place a fragment, the alpha holdout and
 *  the thin layers take it from, so that all see the same fog, worked out once. From what its vertices gave it where
 *  the material's fog is per vertex (`fogVertexed`, from the material record), with the fog's volume over it, read for the
 *  pixel; the whole fog worked out for the pixel otherwise. */
const FOG_VERTEX_FRAGMENT = (layer: string) =>
  wgslBlock(
    'FOG_VERTEX_FRAGMENT',
    [VOLUME_CAMERA_FOG],
    `fn fogVertexed(in:VSOut)->bool{return !(${materialFlagOf('fogPerPixel')});}
fn blendFog(in:VSOut)->vec4f{
 if(!fogVertexed(in)){return blendVolumeFog(in,fogOver(in.view,uni.eye.xyz,in.position.xy));}
 return blendVolumeFog(in,fogVolumeOver(${layer},in.view,uni.eye.xyz));
}`,
  )

/** The same for a program whose surfaces all have their fog worked out for the pixel, or none (`fogVertexOf`). */
const FOG_PIXEL_FRAGMENT = wgslBlock(
  'FOG_PIXEL_FRAGMENT',
  [VOLUME_CAMERA_FOG],
  `fn fogVertexed(in:VSOut)->bool{return false;}
fn blendFog(in:VSOut)->vec4f{return blendVolumeFog(in,fogOver(in.view,uni.eye.xyz,in.position.xy));}`,
)

/** The vertex stage's fog layer: for a material that takes any fog, the fog laid per vertex (far fog and the haze,
 *  then the local fog volumes over them) where it is per vertex, the clouds over it where the material has them
 *  and the program reads them. */
const layerLanes = (fog: boolean, clouds: boolean) => {
  const lay = `if(!(${fogFreeModel('m.model')})){
  ${fog ? `if((m.flags&${MATERIAL_FLAG.fogPerPixel}u)==0u){fogLayer=fogStack(fogLocalVertex(out.view,uni.eye.xyz),fogLaidFar(out.view,uni.eye.xyz,true));}\n  ` : ''}${clouds ? `if(${cloudFogModel('m.model')}){fogLayer=fogStack(cloudFogOver(out.position,out.view,uni.eye.xyz),fogLayer);}\n  ` : ''}}`
  return `var fogLayer=vec4f(0.0,0.0,0.0,1.0);
 ${lay}
 `
}

/** Whether the material of `flags` takes the cloud layer over a fog the fragment lays itself. */
const CLOUD_PER_PIXEL = `(flags&${CLOUD_FOG_MODEL_BIT << MODEL_SHIFT}u)!=0u&&!fogVertexed(in)`

/** What the vertex stage asks of the extras (`vertexExtras.ts`) where the program reads the clouds or the fog per vertex: the fog layer, then
 *  the clouds' shade; a lane another feature asks for comes after them (`withWaterBody`, `selfShadowText`). */
export const vertexAsks = ({ clouds, fog }: VertexReads): ExtraAsk[] =>
  clouds || fog
    ? [{ name: 'fogLayer', lanes: 4 }, ...(clouds ? [{ name: 'shade', lanes: 1 } as const] : [])]
    : []

const texts = new Map<string, CloudVertexText>()

/** The words of the stages of a program that reads the clouds per vertex where `reads.clouds` and the fog per vertex where
 *  `reads.fog`; one of each, made at the first ask. A program whose fog is not per vertex declares it worked out for the pixel. */
export function cloudVertexText({ clouds, fog }: VertexReads): CloudVertexText {
  const key = `${clouds ? ', cloudVertex' : ''}${fog ? ', fogVertex' : ', fogPixel'}`
  let text = texts.get(key)
  if (!text) texts.set(key, (text = buildText(clouds, fog, key)))
  return text
}

function buildText(clouds: boolean, fog: boolean, key: string): CloudVertexText {
  if (!clouds && !fog) return { ...NO_VERTEX_WORDS, key, declared: [FOG_PIXEL_FRAGMENT] }
  const extras = allocateExtras(vertexAsks({ clouds, fog }))
  const layer = extraRead(extras.places.fogLayer)
  const write = extraWrite(extras.places.fogLayer, 'fogLayer')
  const fogFragment = fog ? FOG_VERTEX_FRAGMENT(layer) : FOG_PIXEL_FRAGMENT
  if (!clouds)
    return {
      ...NO_VERTEX_WORDS,
      key,
      declared: [fogFragment],
      extras: extras.members,
      vertexLanes: `${layerLanes(fog, false)}${write}\n `,
    }
  const shade = extras.places.shade
  return {
    key,
    declared: [
      cloudFogFragment(extraRead(extras.places.fogLayer, 'v')),
      cloudFogReadWgsl(BLEND_CLOUD_FOG_BINDINGS),
      blendLit,
      fogFragment,
    ],
    extras: extras.members,
    vertexLanes: `${layerLanes(fog, true)}${write}
 var cloudShade=1.0;
 if(blendLit(flags)){cloudShade=cloudShadeAt(out.view);}
 ${extraWrite(shade, 'cloudShade')}
 `,
    entry: `cloudShadeVertex=${extraRead(shade)};`,
    apply: `if(${CLOUD_PER_PIXEL}){rgb=cloudFogged(rgb,in);}`,
    cloudOver: ` if(!fogFree&&${CLOUD_PER_PIXEL}){fog=fogStack(cloudFogLayer(in),fog);}\n`,
  }
}
