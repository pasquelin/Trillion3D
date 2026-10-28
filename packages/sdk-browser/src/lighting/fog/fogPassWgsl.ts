import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { FULLSCREEN_VERTEX } from '../../gpu/shader/fullscreenTriangle.ts'
import { AS_IS_FLAG, SURFACE_MODEL_MASK } from '../../materials/surface/surfaceModelWord.ts'
import { FOG_FREE_SURFACE_FLAG } from '../../materials/surface/surfaceModel.ts'
import { SURFACE_WORDS } from '../../materials/surface/surfaceOutputs.ts'
import { DEFERRED_BINDINGS, DEFERRED_FOG_BINDINGS } from '../deferred/bindings.ts'
import {
  DEPTH_BINDING_WGSL,
  VIEW_BINDING_WGSL,
  VIEW_PRE_EXPOSED_WGSL,
  WORDS_BINDING_WGSL,
} from '../deferred/litSurfaceWgsl.ts'
import { PIXEL_TILE_CLASS_WGSL } from '../deferred/tileClass.ts'
import { WORLD_AT_WGSL } from '../deferred/worldAtWgsl.ts'
import { directLightWgsl } from '../direct/lightWgsl.ts'
import { AIR_SHOWN } from '../fogBlockAccess.ts'
import { fogBlockOf, type FogResourceBindings } from './readWgsl.ts'

/**
 * THE FOG PASS: the fog laid over the lit image, once, whole — the height fog, the distance fog, the
 * local fog volumes, the fog's volume, the haze of the air on the surfaces, the light shafts' mask —,
 * after the lights and the sky. A fullscreen draw that multiplies what lies in the image by the fog's
 * transmittance, written as its coverage (one minus it), and adds its inscattering, pre-exposed like every light (`FOG_OVER`): the pixel of a
 * surface by the fog along the way from the eye to the surface (`fogOpaque`), the pixel no surface drew,
 * where no atmosphere draws a sky, by the fog along its ray to the far depth (`fogBeyondAt`). A
 * surface shown as it is, one that opts out of the fog, and — in a view of one lighting term — a lit
 * surface, are left. The haze is read from its volume as a 3D texture, sampled by the hardware
 * (`hazeSampledWgsl`).
 */
const FOG_LIGHTS_BINDING_WGSL = wgslBlock(
  'FOG_LIGHTS_BINDING_WGSL',
  [directLightWgsl()],
  `@group(0) @binding(${DEFERRED_BINDINGS.lights}) var<storage,read> directLights:DirectLights;`,
)

/** The fog's bindings in this pass: the cubemap, the volume, the light shafts' mask, the lists of the
 *  local fog volumes and the sampler they are read through, and the haze's volume. */
export const FOG_PASS_BINDINGS = (localFog: boolean): FogResourceBindings => ({
  ...DEFERRED_FOG_BINDINGS,
  localFog,
  haze: DEFERRED_BINDINGS.hazeVolume,
})

/** The fog pass's entry point. */
export const HEIGHT_FOG_ENTRY = 'heightFogMain'

/** The fog behind the water's entry point. */
export const FOG_BEHIND_WATER_ENTRY = 'fogBehindWaterMain'

/** What a program that lays the fog over a point of the scene is made of (`fogOpaque`, `preExposed`, `worldAt`, the view and the fog's
 *  resources, in the fog pass's group 0): the fog pass's own, and a pass that fogs a layer it draws itself reads the same. */
export const fogOverModules = (localFog: boolean) => [
  WORLD_AT_WGSL,
  WORDS_BINDING_WGSL,
  DEPTH_BINDING_WGSL,
  VIEW_BINDING_WGSL,
  FOG_LIGHTS_BINDING_WGSL,
  VIEW_PRE_EXPOSED_WGSL,
  PIXEL_TILE_CLASS_WGSL,
  fogBlockOf(FOG_PASS_BINDINGS(localFog)),
]

const heightFogBody = (localFog: boolean, behindWater: boolean) =>
  wgslBlock(
    `heightFogWgsl(${localFog},${behindWater})`,
    [...fogOverModules(localFog), FULLSCREEN_VERTEX],
    behindWater ? behindWaterText : heightFogText,
  )

const heightFogText = `
@fragment fn ${HEIGHT_FOG_ENTRY}(@builtin(position) pixel:vec4f)->@location(0) vec4f{
 let coord=vec2i(pixel.xy);
 let surfaceFlag=textureLoad(words,coord,${SURFACE_WORDS.flags},0).r;let flag=surfaceFlag&${SURFACE_MODEL_MASK}u;
 let eye=view.display.yzw;
 var over=vec4f(0.0,0.0,0.0,1.0);
 if(flag==0u){
  // A pixel no surface drew: the sky's where an atmosphere is shown, else the background's where the
  // fog shows over it; the raw output of a diagnostic view leaves it empty.
  if(view.viewport.z!=0.0){discard;}
  if(!(${AIR_SHOWN})&&(view.camera.w==0.0||!fogsBackground())){discard;}
  // The ray of the pixel: from the eye, or, in an orthographic view, parallel to the others, as the
  // sky lies under it (\`airRay\`).
  var dir=normalize(worldAt(pixel.xy,0.5)-eye);
  if(view.camera.w==0.0){dir=normalize(worldAt(pixel.xy,0.5)-worldAt(pixel.xy,1.0));}
  over=fogBeyondAt(dir,eye,pixel.xy);
 }else{
  if(flag==${AS_IS_FLAG}u||(surfaceFlag&${FOG_FREE_SURFACE_FLAG}u)!=0u){discard;}
  // A view of one lighting term shows it unfogged.
  if(view.views.x!=0.0&&pixelTileClass(surfaceFlag)!=0u){discard;}
  over=fogOpaque(worldAt(pixel.xy,textureLoad(depth,coord,0)),eye,pixel.xy);
 }
 return vec4f(preExposed(over.rgb),1.0-over.a);
}`

/** The scene without the water, fogged: the copy's pixel (a block of the view's `factor` by `factor`, `factor` the ratio of the view's size to the copy's)
 *  holds the surface at the clip-w depth `waterLinearDepth` reads; its point is where its ray crosses that depth, and the fog along the way from the
 *  eye to it is laid as the pass lays it on the image. A pixel no surface drew (the depth at its furthest), one shown as it is and one that opts out of
 *  the fog are left. */
const behindWaterText = `
@group(0) @binding(${DEFERRED_BINDINGS.waterLinearDepth}) var waterLinearDepth:texture_2d<f32>;
@fragment fn ${FOG_BEHIND_WATER_ENTRY}(@builtin(position) pixel:vec4f)->@location(0) vec4f{
 let coord=vec2i(pixel.xy);
 let factor=view.viewport.x/f32(textureDimensions(waterLinearDepth).x);
 let full=(pixel.xy+0.5)*factor-0.5;
 let surfaceFlag=textureLoad(words,vec2i(full),${SURFACE_WORDS.flags},0).r;let flag=surfaceFlag&${SURFACE_MODEL_MASK}u;
 let linear=textureLoad(waterLinearDepth,coord,0).r;
 if(flag==0u||flag==${AS_IS_FLAG}u||(surfaceFlag&${FOG_FREE_SURFACE_FLAG}u)!=0u||linear>=1e29){discard;}
 let eye=view.display.yzw;
 let a=worldAt(full,1.0);
 let b=worldAt(full,0.5);
 let m=view.viewProjection;
 let clipW=vec4f(m[0].w,m[1].w,m[2].w,m[3].w);
 let clipA=dot(clipW,vec4f(a,1.0));
 let slope=dot(clipW.xyz,b-a);
 let over=fogOpaque(a+(b-a)*((linear-clipA)/select(slope,1e-12,abs(slope)<1e-12)),eye,full);
 return vec4f(preExposed(over.rgb),1.0-over.a);
}`

/** The fog pass's program. */
export const heightFogWgsl = (localFog: boolean) => heightFogBody(localFog, false)
export const fogBehindWaterWgsl = (localFog: boolean) => heightFogBody(localFog, true)
