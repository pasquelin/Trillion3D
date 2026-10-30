import { wgslF32 } from '../../../../math/src/wgsl/number.ts'
import { SUBSURFACE_OPACITY_THRESHOLD } from '../../../../sdk-core/src/lighting/subsurfaceProfile/profile.ts'
import {
  MODEL_FLAG,
  SURFACE_MODEL_MASK,
  UNLIT_FLAG,
} from '../../materials/surface/surfaceModelWord.ts'
import { PIXEL_MODEL } from '../../materials/surface/pixelModel.ts'
import { SPECULAR_FLAG_MASK } from '../../materials/surface/surfaceSpecular.ts'
import { SUBSURFACE_FLAG } from '../../materials/surface/subsurface.ts'
import { SUBSURFACE_MAP_BIT } from '../materialType.ts'

/** The factor of a toon pixel's first texture coordinates before their fraction is kept as its pattern coordinates: the offset and hatching images repeat ten times over the surface by default. */
const TOON_PATTERN_UV_SCALE = '10.0'

/** The iris and caustic normals as differences of octahedral coordinates, an 8-bit channel each (as `shadeGraphWgsl.ts` stores them). */
const delta = (v: string) => `quantise8x2((${v})*0.5+128.0/255.0)`

/**
 * THE SHADING MODEL OF A MATERIAL WITHOUT A GRAPH'S (`MaterialParameters.shadingModel`), on a lit pixel of the physical model: the model's
 * number in the surface flags and what it reads in the thin transmission's target, from the material's record — the same data as
 * the graph's per-pixel model leaves (`pixelModels`, `shadeGraphWgsl.ts`).
 * - The thin subsurface: its `subsurfaceColor` (times its map) and its opacity, and the mark of a thin transmission too (`SUBSURFACE_FLAG`:
 *   the shadows and the probes read it).
 * - The preintegrated skin: its `subsurfaceColor` and its opacity (the byte of the record's model word, `subsurfaceOpacityOfModel`).
 * - The subsurface profile: its number (`subsurfaceProfileOfModel`) and that opacity; at or under the threshold the plain model.
 * - The eye: its profile, one minus its iris mask in the opacity byte, its distance (`irisDistance`, in the metalness) and the iris direction
 *   the graph's default gives, the reference's own decoded one, (0, 0, -1) — or, with `irisNormal`, the iris and the caustic normal as the
 *   surface's own.
 * - The hair: its fibre direction is the page's tangent, in the normal's place (the surface's normal where the page stores no tangent); its
 *   scatter amount the metalness.
 * - The toon: its toon profile's row (`subsurfaceProfileOfModel`) and the pixel's pattern coordinates, the fraction of its first set of
 *   texture coordinates times 10 (`TOON_PATTERN_UV_SCALE`, so that the offset and hatching images show by default; none held: zero), as the reference stores them.
 * - The unlit model shows the material's emission alone, as an unlit pixel of a graph does.
 * Only a class that holds `HAS_SHADING_MODEL` (the record names a shading model, `materialClassKey`) compiles any of it; the others hold `mmModel` 0
 * and none of these branches.
 * `mmModel` is the number of the pixel model the material gives (0 for none, and where its graph wires the output); the thin sheet block
 * leaves a pixel of a model alone.
 */
export const materialModelStatements = (graphDecides: boolean) =>
  graphDecides
    ? ' let mmModel=0u;\n'
    : ` var mmModel=0u;
 if(HAS_SHADING_MODEL){
 mmModel=shadingModelOfModel(m.model);
 if(shadingUnlitOfModel(m.model)&&(flag&${SURFACE_MODEL_MASK}u)==${MODEL_FLAG.physical}u){
  flag=(flag&~${SURFACE_MODEL_MASK}u)|${UNLIT_FLAG}u;
  rgb=emissive;emissive=vec3f(0.0);metal=0.0;ao=1.0;
 }
 if(mmModel!=0u&&(flag&${SURFACE_MODEL_MASK}u)==${MODEL_FLAG.physical}u&&!(mmModel==${PIXEL_MODEL.profile}u&&subsurfaceOpacityOfModel(m.model)<=${wgslF32(SUBSURFACE_OPACITY_THRESHOLD)})){
  flag|=pixelModelFlag(mmModel);
  var mmThin=vec3f(0.0);
  var mmAlpha=subsurfaceOpacityOfModel(m.model);
  if(mmModel==${PIXEL_MODEL.skin}u){mmThin=clamp(m.subsurface,vec3f(0.0),vec3f(1.0));}
  if(mmModel==${PIXEL_MODEL.subsurface}u){
   mmThin=clamp(m.subsurface,vec3f(0.0),vec3f(1.0));
   if(HAS_UV&&m.subsurfaceMap!=0u){let c=mapCoord(m,${SUBSURFACE_MAP_BIT}u);mmThin*=colorSample(m.subsurfaceMap,c.uv,c.ddx,c.ddy,HAS_SAMPLING).rgb;}
   if(any(mmThin>vec3f(0.0))){flag|=${SUBSURFACE_FLAG}u;}
  }
  if(mmModel==${PIXEL_MODEL.profile}u){mmThin=vec3f(subsurfaceProfileOfModel(m.model),0.0,0.0);}
  if(mmModel==${PIXEL_MODEL.toon}u){
   mmThin=vec3f(subsurfaceProfileOfModel(m.model),select(vec2f(0.0),fract(uv*${TOON_PATTERN_UV_SCALE}),HAS_UV));
  }
  if(mmModel==${PIXEL_MODEL.eye}u){
   mmAlpha=quantise8(mmAlpha);
   if(uni.irisNormal==0u){
    let mmIris=quantise8x2(octEncode(vec3f(0.0,0.0,-1.0))*0.5+0.5);
    mmThin=vec3f(subsurfaceProfileOfModel(m.model),mmIris.x,mmIris.y);
    metal=quantise8(m.irisDistance);
   }else{
    let mmDelta=${delta('vec2f(0.0)')};
    mmThin=vec3f(subsurfaceProfileOfModel(m.model),mmDelta.x,mmDelta.y);
    metal=mmDelta.x;
    flag&=~${SPECULAR_FLAG_MASK}u;
    flag|=specularFlag(mmDelta.y);
   }
  }
  if(mmModel==${PIXEL_MODEL.hair}u&&HAS_TANGENT){N=tangents.T;}
  thinOut=mmThin;thinOpacity=mmAlpha;
 }
 }
`
