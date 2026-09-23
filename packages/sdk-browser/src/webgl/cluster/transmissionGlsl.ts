/**
 * What the transmission pass adds to the cluster fragment shader, and nothing else: a volume, two
 * backdrop samplers and two functions. A fragment the `transmissive` flag does not carry never
 * calls them, so the image of every other material does not move by a pixel.
 *
 * Same model as the engine's WebGPU blend shader (`webgpuTransmissionWgsl.ts`), on the imported
 * material alone — `KHR_materials_transmission`, `KHR_materials_ior`, `KHR_materials_volume` —
 * and on the declared lights the rest of the program reads. Depth here is the host projection's
 * forward window depth, so "behind the glass" is "greater".
 */
export const TRANSMISSION_GLSL = `
uniform bool transmissive;uniform vec4 volume;uniform vec3 attenuationColor;
uniform sampler2D backdrop,backdropDepth;uniform vec2 backdropOrigin;
// Backdrop the surface lets through. The view ray is bent by the material IOR, advanced by its
// thickness, reprojected to the screen: that is where the frozen colour is reread. A sample whose
// copied depth places it in front of the surface would show an object in front of the glass: the
// unbent sample is taken instead. The volume then attenuates by its colour.
vec3 transmittedBackdrop(vec3 P,vec3 N,vec3 V){ivec2 size=textureSize(backdrop,0),last=size-1;
ivec2 straight=clamp(ivec2(gl_FragCoord.xy-backdropOrigin),ivec2(0),last),deviated=straight;
vec3 refracted=refract(-V,N,1.0/max(volume.y,1e-3));
if(dot(refracted,refracted)>1e-8&&volume.z>0.0){vec4 clip=projectionMatrix*vec4(P+normalize(refracted)*volume.z,1.0);
if(clip.w>0.0){vec2 ndc=clip.xy/clip.w;deviated=clamp(ivec2((ndc*0.5+0.5)*vec2(size)),ivec2(0),last);}}
ivec2 chosen=texelFetch(backdropDepth,deviated,0).r>=gl_FragCoord.z?deviated:straight;
vec3 attenuation=vec3(1.0);if(volume.w>0.0){vec3 sigma=-log(clamp(attenuationColor,vec3(1e-5),vec3(1.0)))/volume.w;attenuation=exp(-sigma*volume.z);}
return texelFetch(backdrop,chosen,0).rgb*attenuation;}
// Composition of a transmissive surface, the glTF model: a = alpha + t(1-alpha), and a*C carries
// the whole transmitted share. At zero transmission, colour and opacity are those of a blended
// surface, to the bit. The transmitted share returns the refracted backdrop weighted by 1-F and
// the specular of the declared lights on a null albedo: the diffuse lobe cancels, the dielectric
// specular lobe stays. The normal is that of the face we look from: we always enter by it.
vec4 transmissionColor(vec3 litColor,vec3 baseTint,float alpha,vec3 N,vec3 V,vec3 P,float rough,float ao){
vec3 Nv=dot(N,V)>0.0?N:-N;float t=clamp(volume.x,0.0,1.0),f0=pow((volume.y-1.0)/(volume.y+1.0),2.0);
float F=f0+(1.0-f0)*pow(clamp(1.0-max(dot(Nv,V),0.0),0.0,1.0),5.0);
vec3 transmitted=baseTint*transmittedBackdrop(P,Nv,V),reflected=lit?shade(Nv,V,vec3(0.0),0.0,rough,ao):vec3(0.0);
float a=alpha+t*(1.0-alpha);return vec4((t*((1.0-F)*transmitted+reflected)+(1.0-t)*alpha*litColor)/max(a,1e-4),a);}`;
