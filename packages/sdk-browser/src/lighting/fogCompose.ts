import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { FOG_MODE, FOG_SLOT } from '../../../sdk-core/src/scene/core/fog.ts'
import { LOCAL_FOG_FLAG } from './fog/localLayout.ts'
import { FOG_LOCAL_OVER_WGSL } from './fog/localWgsl.ts'
import { AIR_SHOWN, fog } from './fogBlockAccess.ts'

/**
 * THE FOG LAID OVER A POINT, from the analytic fog (`./fogShader.ts`), the haze of the air, the local
 * fog volumes and the fog's volume.
 *
 * `fogOver`: the fog apart, for a layer that multiplies what lies behind it — its inscattering,
 * then the transmittance from the eye to `P`; no fog adds nothing and keeps everything —
 * `fogOverNoHaze`: the same without the haze of the air, for a layer that lays the haze itself — and
 * `fogged`: a lit colour at the world point `P` seen from `eye`, behind the fog; no fog leaves it
 * as it is.
 *
 * With an atmosphere the sky's mean radiance, times the fog's factor and the atmosphere's
 * contribution, adds to the fog's colour, the sun's light on the ground to the lobe's — and where
 * the air holds a second light, a second lobe toward it, of the fog's own colour and its light on
 * the ground, through the same density as the first — and the
 * haze of the air (`aerialPerspective`, `../atmosphere/hazeReadWgsl.ts`) lies over the fog's: the
 * fog's inscattering and transmittance first, then the haze's light through the fog's
 * transmittance, the two transmittances multiplied. A fog that holds its light out (`fogHeld`) leaves the coverage of all of it alone: the
 * height fog's, the local volumes', the haze's and the volume's inscattering are nothing. Without one, nothing of it is read. The local fog
 * volumes (`localFogOver`, `./fog/localWgsl.ts`) lie over the height fog, the haze behind both: a surface,
 * a translucent fragment and the clouds are fogged by them, a translucent surface's vertex only where the run says so
 * (`LOCAL_FOG_FLAG.onTranslucent`); each is given the pixel it is seen in, which finds the tile whose
 * list of volumes it walks (`localFogListAt`). A program made without the local fog volumes (the project
 * switch `localFogVolumeSupport`, `fogComposeWgsl(false)`) holds none of that code: its fog is the
 * height fog, the haze and the volume. Nearest of all lies the volume (`fogVolumeLookup`,
 * `./fog/readWgsl.ts`): its light, and the fog, the local volumes and the haze through its
 * transmittance — the local volumes under it whether the run voxelises them into it (`LOCAL_FOG_FLAG.inVolume`, the default) or not.
 *
 * `fogBeyond`: the same fog over the point a ray that leaves the scene along the unit `dir` reaches
 * at the far depth (`FOG_FAR_DEPTH`, what the depth buffer's far value converts to), the sky's
 * pixel, with no haze, for the sky is the air. A ray that rises keeps what the density above the
 * eye lets through, nothing near the horizon; a level or falling one keeps nothing, so that from
 * the horizon down the pixel is the fog's colour alone; a cutoff distance leaves the sky as it is.
 * A distance fog leaves the sky as it is. `fogBeyondAt`, the same over the sky's pixel, lays the local
 * fog volumes too, which `fogBeyond` — the sky light's capture reads it — does not. The view's
 * height fog is shown there by the view (`heightFogShown`) and lit by the sky light; the capture's
 * draws it whatever the view says (its own switch is `inSkyCapture`, on the CPU) and unlit by the
 * sky light, which would read what it writes.
 * `fogsBackground`: whether the pixels no surface drew are fogged by the fog pass (`./fog/fogPass.ts`) itself,
 * because no sky is drawn on them — a height fog and no atmosphere, or a local fog volume and no atmosphere.
 */
const composed = new Map<boolean, ReturnType<typeof wgslBlock>>()

/** The fog's composition, over the local fog volumes where `local` (the project switch
 *  `localFogVolumeSupport`, on by default), else without any of their code; one block of each, made at
 *  the first ask. */
export function fogComposeWgsl(local: boolean) {
  let block = composed.get(local)
  if (!block) composed.set(local, (block = composeBlock(local)))
  return block
}

/** What the composition asks of the local fog volumes, as text: whether one lies over a point (the view
 *  draws one), and the layer they lay over a point seen in a pixel; nothing of either where the program is
 *  made without them. The volumes lie under the fog's volume, over the height fog and the haze behind both.
 *  A fragment lays them whether the run puts them on a translucent surface or not; a vertex works them out
 *  only where it does (\`LOCAL_FOG_FLAG.onTranslucent\`). */
function localFogText(local: boolean) {
  return {
    functions: local
      ? `/** Whether a local fog volume lies over a point: the view draws one. */
fn localFogApplies()->bool{return localFogCount()>0u;}
`
      : '',
    laid: (toward: string) =>
      local ? `\n if(local){over=fogStack(fogHeld(localFogOver(${toward},pixel)),over);}` : '',
    // A vertex's volumes: those of the tile it lies in, when a translucent surface is fogged by them.
    vertex: local
      ? `if(!fogDrawn()||!localFogFlagged(${LOCAL_FOG_FLAG.onTranslucent}u)){return vec4f(0.0,0.0,0.0,1.0);}\n return fogHeld(localFogOverVertex(P-eye));`
      : 'return vec4f(0.0,0.0,0.0,1.0);',
    background: local ? '||localFogApplies()' : '',
    free: local ? '&&!localFogApplies()' : '',
    applies: local ? 'localFogApplies()' : 'false',
  }
}

type LocalFogText = ReturnType<typeof localFogText>

/** The stack of two layers of fog and the fog beyond the surfaces. */
const composeBeyondText = (text: LocalFogText) => `
/** \`near\` over \`behind\`: the light of the nearer, and what it lets through of the other. */
fn fogStack(near:vec4f,behind:vec4f)->vec4f{
 return vec4f(near.rgb+behind.rgb*near.a,near.a*behind.a);
}
${text.functions}/** The fog along \`toward\`, the ray from \`eye\` to the point it reaches: an endless one for the sky (\`fogBeyondWith\`), the distance of the surface seen for a capture that has its depth. */
fn fogBeyondAlong(toward:vec3f,eye:vec3f,local:bool,pixel:vec2f,inView:bool)->vec4f{
 if(!fogDrawn()){return vec4f(0.0,0.0,0.0,1.0);}
 let height=${fog(FOG_SLOT.color)}.w>${FOG_MODE.exponential - 0.5};
 var over=vec4f(0.0,0.0,0.0,1.0);
 if(height&&inView){over=heightFogAlong(toward,eye.y,fogSkyShown());}
 if(height&&!inView){over=heightFogLaw(toward,eye.y,fogSkyShown(),false);}${text.laid('toward')}
 if(height){over=fogStack(fogHeld(fogVolumeLookup(toward)),over);}
 return over;
}
fn fogBeyondWith(dir:vec3f,eye:vec3f,local:bool,pixel:vec2f,inView:bool)->vec4f{return fogBeyondAlong(dir*FOG_FAR_DEPTH,eye,local,pixel,inView);}
fn fogBeyond(dir:vec3f,eye:vec3f)->vec4f{return fogBeyondWith(dir,eye,false,vec2f(0.0),false);}`

/** The fog laid over a point, and the applications of it. */
const composeLaidText = (text: LocalFogText) => `fn fogsBackground()->bool{
 return fogDrawn()&&((${fog(FOG_SLOT.color)}.w>${FOG_MODE.exponential - 0.5}&&heightFogShown())${text.background})&&!(${AIR_SHOWN});
}
/** The far part of the fog laid over \`P\`: the analytic fog along the ray, the haze of the air behind it where
 *  \`haze\`. It reads the light buffer and the fog's cubemap alone, so a vertex stage may work it out
 *  (\`fogNear\` completes it). */
fn fogLaidFar(P:vec3f,eye:vec3f,haze:bool)->vec4f{
 var over=vec4f(0.0,0.0,0.0,1.0);
 if(!fogDrawn()){return over;}
 let withSky=fogSkyShown();
 let mode=${fog(FOG_SLOT.color)}.w;
 if(mode>${FOG_MODE.exponential - 0.5}){over=heightFog(P,eye,withSky);}
 else if(mode>${FOG_MODE.none}.5){over=linearFog(P,eye,withSky);}
 if(haze&&${AIR_SHOWN}){over=fogStack(over,fogHeld(aerialPerspective(P,eye)));}
 return over;
}
/** The local fog volumes over a vertex \`P\` seen from \`eye\`, in the tile the vertex lies in, where a translucent
 *  surface is fogged by them (\`LOCAL_FOG_FLAG.onTranslucent\`): the layer to lay over \`fogLaidFar\` at the vertex;
 *  none, \`(0, 0, 0, 1)\`, otherwise. It reads the light buffer and the lists of the volumes alone. */
fn fogLocalVertex(P:vec3f,eye:vec3f)->vec4f{
 ${text.vertex}
}
/** The fog's volume, nearest of all, laid over \`layer\` at \`P\`: its light, and \`layer\` through its
 *  transmittance. The volume is read for each pixel (its texture is the fragment stage's). */
fn fogVolumeOver(layer:vec4f,P:vec3f,eye:vec3f)->vec4f{
 if(!fogDrawn()||${fog(FOG_SLOT.color)}.w<=${FOG_MODE.exponential - 0.5}){return layer;}
 return fogStack(fogHeld(fogVolumeLookup(P-eye)),layer);
}
/** The near part, laid over \`far\` (\`fogLaidFar\`, at this point, worked out where the material says): the local
 *  fog volumes seen in the pixel \`pixel\`, and nearest of all the fog's volume. */
fn fogNear(far:vec4f,P:vec3f,eye:vec3f,local:bool,pixel:vec2f)->vec4f{
 var over=far;
 if(!fogDrawn()){return over;}${text.laid('P-eye')}
 over=fogVolumeOver(over,P,eye);
 return over;
}
fn fogLaid(P:vec3f,eye:vec3f,haze:bool,local:bool,pixel:vec2f)->vec4f{
 return fogNear(fogLaidFar(P,eye,haze),P,eye,local,pixel);
}
/** The fog of a translucent layer, and of the clouds, which lay the haze themselves, seen in the pixel
 *  \`pixel\` of the view. */
fn fogOver(P:vec3f,eye:vec3f,pixel:vec2f)->vec4f{return fogLaid(P,eye,true,${text.applies},pixel);}
fn fogOverNoHaze(P:vec3f,eye:vec3f,pixel:vec2f)->vec4f{return fogLaid(P,eye,false,${text.applies},pixel);}
/** The fog \`over\` seen at the pixel \`pixel\` of the scene, its inscattering multiplied by the light
 *  shafts' occlusion mask there (\`lightShaftMask\`, \`./fog/readWgsl.ts\`): the whole fog's — the
 *  height fog, the local volumes, the volume and the haze laid with them —, its transmittance as it is; and
 *  \`fogBeyondAt\`, the same over the sky's pixels. */
fn fogShafted(over:vec4f,pixel:vec2f)->vec4f{return vec4f(over.rgb*lightShaftMask(pixel),over.a);}
fn fogBeyondAt(dir:vec3f,eye:vec3f,pixel:vec2f)->vec4f{return fogShafted(fogBeyondWith(dir,eye,true,pixel,true),pixel);}
/** The fog \`over\` an opaque surface at the point \`P\` seen from \`eye\` in the pixel \`pixel\`, as the fog
 *  pass lays it over the lit image (\`../fog/fogPass.ts\`): its inscattering and its transmittance, the
 *  light shafts' mask applied; none, \`(0, 0, 0, 1)\`, where there is no fog. The haze is left out where
 *  it is marched for each pixel instead. */
fn fogOpaque(P:vec3f,eye:vec3f,pixel:vec2f)->vec4f{
 if(${fog(FOG_SLOT.color)}.w==${FOG_MODE.none}.0&&!(${AIR_SHOWN})${text.free}){return vec4f(0.0,0.0,0.0,1.0);}
 return fogShafted(fogLaid(P,eye,!opaqueHazeMarched(),${text.applies},pixel),pixel);
}
/** What the fog over \`P\` lets of a layer behind through, as \`fogged\` does: the alpha holdout accumulates it. */
fn fogThrough(P:vec3f,eye:vec3f,pixel:vec2f)->f32{
 if(${fog(FOG_SLOT.color)}.w==${FOG_MODE.none}.0&&!(${AIR_SHOWN})${text.free}){return 1.0;}
 return fogOver(P,eye,pixel).a;
}
/** What the fog over \`P\` lets of a layer that multiplies the scene through: its transmittance squared (the
 *  layer's light crosses the fog once to the scene it modulates and the scene's once more). */
fn fogThroughModulating(P:vec3f,eye:vec3f,pixel:vec2f)->f32{
 let seen=fogThrough(P,eye,pixel);
 return seen*seen;
}
/** \`rgb\` seen through the fog, its inscattering taken at the share \`inscatter\` of its own: a layer
 *  whose colour is already weighed by its opacity takes it at that opacity. */
fn foggedBy(rgb:vec3f,inscatter:f32,P:vec3f,eye:vec3f,pixel:vec2f)->vec3f{
 if(${fog(FOG_SLOT.color)}.w==${FOG_MODE.none}.0&&!(${AIR_SHOWN})${text.free}){return rgb;}
 let over=fogOver(P,eye,pixel);
 return rgb*over.a+over.rgb*inscatter;
}
fn fogged(rgb:vec3f,P:vec3f,eye:vec3f,pixel:vec2f)->vec3f{return foggedBy(rgb,1.0,P,eye,pixel);}`

function composeBlock(local: boolean) {
  const text = localFogText(local)
  return wgslBlock(
    `FOG_COMPOSE_WGSL(${local})`,
    local ? [FOG_LOCAL_OVER_WGSL] : [],
    `${composeBeyondText(text)}
${composeLaidText(text)}`,
  )
}
