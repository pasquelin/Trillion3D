import { LOBE_AXIS_WGSL } from '../../lighting/lobeAxisWgsl.ts'
import { SURFACE_F0_WGSL } from '../../materials/surface/surfaceSpecular.ts'
import { FLAG_UNLIT_VIEW } from '../../visibility/types.ts'
import { fogFreeFlag, MASKED_MODEL_BIT } from '../../materials/surface/surfaceModelWord.ts'
import { BLEND_TO_EYE_WGSL } from '../shaderSurface.ts'
import { GRAPH_FLAG } from '../graphWgsl.ts'
import type { CloudVertexText } from '../cloudVertexText.ts'
import { FACING_MATERIAL_MASK } from '../facing.ts'
import { WORDS } from '../vertexReadsWgsl.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { fresnelSchlick, specularF90 } from '../../../../math/src/wgsl/lighting.ts'

/** The label of a stage's variant: which of the optional pieces its text holds. */
export const variantKey = (o: {
  graphs: boolean
  lobes: boolean
  shade: CloudVertexText
  marks?: boolean
  depth?: boolean
  layer: boolean
}) =>
  `${o.graphs}${o.lobes ? ', lobes' : ''}${o.shade.key}${o.marks ? ', surface shadow marks' : ''}${o.depth ? ', pushed depth' : ''}${o.layer ? ', layer' : ''}`

/**
 * A transmissive layer as a thin translucent surface leaves it — an infinitely thin absorbing
 * sheet under a lit coat —, its lights aside: what the blend multiplies the destination by. It reads the fragment's surface (`blendSurface`) and its record's volume (`materialAt`, the
 * rank the vertex stage passes in `VSOut.words.z`), the blend module's view and lights' fog.
 */
export const thinLayerWgsl = (
  graphs: boolean,
  lobes: boolean,
  shade: CloudVertexText,
  layer: boolean,
) =>
  wgslBlock(
    `THIN_LAYER_WGSL(${variantKey({ graphs, lobes, shade, layer })})`,
    [SURFACE_F0_WGSL, fresnelSchlick, specularF90, LOBE_AXIS_WGSL, BLEND_TO_EYE_WGSL],
    `struct Thin{N:vec3f,V:vec3f,rough:f32,metal:f32,top:f32,specularColor:vec3f,transmittance:vec3f,fog:vec4f,coverage:f32,unlit:bool,}
fn thinLayer(in:VSOut,k:TransmitIn)->Thin{
 let s=k.s;
 let flags=in.ids.y;
 let m=materialAt(in.${WORDS.material}&${FACING_MATERIAL_MASK}u);
 let V=blendToEye(in);
 // The normal of the side we look from: a single-sided surface, or a mesh with no normal
 // attribute, can arrive turned the wrong way, and Fresnel would turn black.
 let N=faceForward(s.N,-V,s.N);
 let metal=clamp(s.metal,0.0,1.0);
 let unlit=(flags&${FLAG_UNLIT_VIEW}u)!=0u;
 let t=clamp(m.transmission,0.0,1.0);
 // The glTF transmission mapped on the thin layer: the lit layer covers by
 // max(1-t, metallic, roughness) — a metal transmits nothing, a rough surface scatters —,
 // the transmittance colour is baseColor·t, and the surface coverage is one. A material of alpha mode mask
 // is clear where its base map's alpha reaches a third: the layer there
 // covers nothing, transmits all and has no specular, and the base colour tints it where it does not.
 let masked=(m.model&${MASKED_MODEL_BIT}u)!=0u${layer ? `&&(k.g.graph.flags&${GRAPH_FLAG.layer}u)==0u` : ''};
 let cut=select(0.0,1.0,masked&&k.mapAlpha>=0.333);
 var top=(1.0-cut)*max(1.0-t,max(metal,clamp(s.rough,0.0,1.0)));
 var tint=mix(s.rgb*t,vec3f(1.0),cut);
 var coverage=1.0;
${layer ? ` if((k.g.graph.flags&${GRAPH_FLAG.layer}u)!=0u){top=clamp(s.alpha,0.0,1.0);tint=k.g.graph.layer;coverage=k.g.graph.coverage;}` : ''}
 // Thin translucency: N·V of either side; the colour absorbed over a path of rcp(N·V), the
 // sheet's thickness seen at a slant; Fresnel at entry and again at exit (Schlick 1994, its
 // grazing value occluded under 2% specular) on the surface's specular colour (\`surfaceF0\`),
 // which follows its base colour and metal.
 let NoV=clamp(abs(dot(N,V))+1e-5,0.0,1.0);
 ${graphs ? 'surfaceSpecular=s.specular;\n ' : ''}${lobes ? 'if(physicalOn&&blendLobeValues.specular>=0.0){surfaceSpecular=blendLobeValues.specular;}\n ' : ''}if(masked){surfaceSpecular=1.0-cut;}
 let specularColor=surfaceF0(s.rgb,metal);
 let F=fresnelSchlick(specularColor,specularF90(specularColor),NoV);
 let absorbed=pow(max(tint,vec3f(1e-6)),vec3f(1.0/NoV));
 // The fog between the eye and the surface; a fog-free material, or the unlit view, takes none.
 let fogFree=unlit||${fogFreeFlag('flags')};
 var fog=vec4f(0.0,0.0,0.0,1.0);
 if(!fogFree){fog=blendFog(in);}
${shade.cloudOver} return Thin(N,V,lobeRoughness(s.rough),metal,top,specularColor,(1.0-F)*(1.0-F)*absorbed*(1.0-top),fog,coverage,unlit);
}
// What the destination is multiplied by: the transmittance faded to one by the surface
// coverage, and dimmed by the fog.
fn thinMul(l:Thin)->vec3f{return mix(vec3f(1.0),l.fog.a*l.transmittance,l.coverage);}
// The fallback without dual-source blending: the multiply as one grey coverage.
fn greyCoverage(mul:vec3f)->f32{return saturate(1.0-dot(mul,vec3f(1.0/3.0)));}
`,
  )
