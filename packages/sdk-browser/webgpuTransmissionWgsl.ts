import { BLEND_BINDINGS } from './webgpuBindLayout.ts';

/**
 * Ce que la classe 3 — la transmission — ajoute au nuanceur des mélanges, et rien d'autre : trois
 * liaisons et deux fonctions. Un fragment qui ne porte pas le drapeau de transmission ne les
 * appelle jamais, si bien que l'image des deux autres classes ne bouge pas d'un pixel.
 *
 * Tout se lit sur le matériau importé — `KHR_materials_transmission`, `KHR_materials_ior`,
 * `KHR_materials_volume` — et sur les sources déclarées de la scène : les lampes du contrat et la
 * grille de sondes, celles-là mêmes que lit le reste du mélange. Aucune lumière propre à cette
 * passe (P6), aucune scène nommée, aucune constante calée sur une scène.
 */
export const TRANSMISSION_WGSL = `
struct Volume{transmission:f32,ior:f32,thickness:f32,attenuationDistance:f32,attenuationColor:vec4f,}
@group(0) @binding(${BLEND_BINDINGS.volume}) var<uniform> volume:Volume;
@group(0) @binding(${BLEND_BINDINGS.backdrop}) var backdrop:texture_2d<f32>;
@group(0) @binding(${BLEND_BINDINGS.backdropDepth}) var backdropDepth:texture_depth_2d;
// Le fond que la surface laisse voir. Le rayon de vue est dévié par l'indice du matériau, avancé de
// son épaisseur, reprojeté à l'écran : c'est là qu'on relit la couleur déjà dessinée. Un échantillon
// dont la profondeur copiée le place devant la surface montrerait un objet situé devant le verre :
// on retombe alors sur l'échantillon non dévié. Le volume atténue ensuite selon sa couleur.
fn transmittedBackdrop(P:vec3f,N:vec3f,V:vec3f,fragXY:vec2f,fragZ:f32)->vec3f{
 let size=vec2f(textureDimensions(backdrop));
 let last=size-vec2f(1.0);
 let straight=vec2i(clamp(fragXY,vec2f(0.0),last));
 let refracted=refract(-V,N,1.0/max(volume.ior,1e-3));
 var deviated=straight;
 if(dot(refracted,refracted)>1e-8&&volume.thickness>0.0){
  let clipPos=uni.viewProj*vec4f(P+normalize(refracted)*volume.thickness,1.0);
  if(clipPos.w>0.0){
   let ndc=clipPos.xy/clipPos.w;
   deviated=vec2i(clamp(vec2f((ndc.x*0.5+0.5)*size.x,(0.5-ndc.y*0.5)*size.y),vec2f(0.0),last));
  }
 }
 let chosen=select(straight,deviated,textureLoad(backdropDepth,deviated,0)>=fragZ);
 var attenuation=vec3f(1.0);
 if(volume.attenuationDistance>0.0){
  let sigma=-log(clamp(volume.attenuationColor.rgb,vec3f(1e-5),vec3f(1.0)))/volume.attenuationDistance;
  attenuation=exp(-sigma*volume.thickness);
 }
 return textureLoad(backdrop,chosen,0).rgb*attenuation;
}
// La composition d'une surface transmissive. La part transmise remplace le mélange alpha — c'est le
// modèle de glTF : a = alpha + t(1-alpha), et a·C porte la part transmise entière. À transmission
// nulle, la couleur et l'opacité rendues sont celles de la classe 2, au bit près.
//
// Ce que la part transmise renvoie : le fond réfracté pondéré par 1-F, la réflexion de
// l'environnement pondérée par F — l'irradiance des sondes dans la direction du miroir, exactement
// zéro quand la scène n'en porte pas —, et le spéculaire des lampes déclarées, obtenu en évaluant
// la seule formule d'éclairement du moteur sur un albédo nul : le lobe diffus s'annule, le lobe
// spéculaire diélectrique reste. Une vue sans éclairage n'en garde aucun des deux.
fn transmissionColor(lit:vec3f,baseTint:vec3f,alpha:f32,N:vec3f,V:vec3f,P:vec3f,fragXY:vec2f,fragZ:f32,rough:f32,ao:f32,unlit:bool)->vec4f{
 let t=clamp(volume.transmission,0.0,1.0);
 let f0=pow((volume.ior-1.0)/(volume.ior+1.0),2.0);
 let F=f0+(1.0-f0)*pow(clamp(1.0-max(dot(N,V),0.0),0.0,1.0),5.0);
 let transmitted=baseTint*transmittedBackdrop(P,N,V,fragXY,fragZ);
 var reflected=vec3f(0.0);
 if(!unlit){
  reflected=F*sampleBounce(P,reflect(-V,N))*BOUNCE_INVERSE_PI
   +declaredLighting(vec3f(0.0),0.0,rough,N,V,P,ao);
 }
 let a=alpha+t*(1.0-alpha);
 return vec4f((t*((1.0-F)*transmitted+reflected)+(1.0-t)*alpha*lit)/max(a,1e-4),a);
}
`;
