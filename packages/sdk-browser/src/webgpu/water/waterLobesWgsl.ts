import { LOBES_TARGET_WGSL } from '../../lighting/direct/lobesWgsl.ts'
import { FORWARD_MIRROR_WGSL } from '../../reflections/modelShader.ts'
import { VOLUME_LOBED } from '../transparent/transmission.ts'

/**
 * The anisotropic and clear-coat lobes of a water pixel, in the composite's lobed programs
 * (`compositeWgsl.ts`, a key without `lobeless`): the lighting's one implementation
 * (`../../lighting/direct/lobesWgsl.ts`), on the texel the lobed surface stage left in the lobes
 * target (`surfaceWgsl.ts`) by the fragment that set the pixel's word. Read only where the volume
 * says its surface carries a lobe (`VOLUME_LOBED`) — a pixel of another surface finds there the
 * opaque resolve's lobes, or an earlier image's — and where that texel holds one; its coat normal is
 * turned with the normal the composite lights (`waterFacing`).
 *
 * Under the coat, as on a blend: each light (`lobeLight`, a dielectric's reflectance on the
 * reflection's null albedo), the environment, the bounce, the mirror term and the transmitted
 * backdrop, by what the coat lets through (`lobeThrough`); above it, the coat's own mirror term
 * (`waterCoatMirror`), the forward passes' one (`FORWARD_MIRROR_WGSL`) on the coat normal at the
 * coat roughness.
 */
export const WATER_LOBES_WGSL = `${LOBES_TARGET_WGSL}
${FORWARD_MIRROR_WGSL}
/** The lobes of the water pixel at \`coord\`, set for its lights (\`lobesAt\`, the opaque resolve's
 *  decode); \`side\` is -1 where the composite turned the stored normal to face the eye. */
fn waterLobes(vol:Volume,coord:vec2i,N:vec3f,V:vec3f,rough:f32,side:f32){
 if(!volumeMarked(vol,${VOLUME_LOBED}u)){return;}
 let w=textureLoad(physicalLobes,coord);
 if(w.z==0u){return;}
 lobesAt(w,side,N,V,rough);
}
/** The reflection \`reflected\` and the coat's own above it, none without a coat. */
fn waterCoatMirror(reflected:vec3f,V:vec3f,P:vec3f)->vec3f{
 if(!lobes.on||!(lobes.coat>0.0)){return reflected;}
 return reflected+lobes.coat*surfaceMirrorLighting(vec3f(0.0),0.0,lobes.coatRough,lobes.coatN,V,P);
}`

/** The composite's lobeless programs: no lobe is read, the reflection is the surface's alone. */
export const WATER_LOBELESS_WGSL = `fn waterLobes(vol:Volume,coord:vec2i,N:vec3f,V:vec3f,rough:f32,side:f32){}
fn waterCoatMirror(reflected:vec3f,V:vec3f,P:vec3f)->vec3f{return reflected;}`
