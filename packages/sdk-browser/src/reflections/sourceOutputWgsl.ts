import { FOG_FREE_SURFACE_FLAG } from '../scene/surfaceModel.ts';

const ENTRY = '@fragment fn lightSurface(@builtin(position) pixel:vec4f)->@location(0) vec4f{';
const MIRROR = '+mirrorLighting(base.rgb,base.a,normal.a,N,V,P)';
const CAMERA_FOG = `if((surfaceFlag&${FOG_FREE_SURFACE_FLAG}u)==0u){rgb=fogged(rgb,P,view.display.yzw);}`;
const HELD = 'reflectionSourceRgb=rgb;reflectionSourceHeld=true;';

/**
 * The one lighting pass of a reflecting image writes, beside the lit image, the colour the next
 * image's reflections read (`source.ts`): the same radiance before camera fog and without the
 * mirror term, as the source always was; the lit image is the same sum, the mirror added last. A
 * pixel the body returns without such a colour (unlit, as-is) keeps its lit value there. Nothing
 * drawn after the lighting (transparents, water, particles) reaches it.
 */
export function withReflectionSourceOutput(shader: string) {
  if (!shader.includes(ENTRY) || !shader.includes(CAMERA_FOG + '\n'))
    throw new Error('REFLECTION_SOURCE_OUTPUT_UNMATCHED');
  const lit = shader
    .replace(ENTRY, 'fn litSurface(pixel:vec4f)->vec4f{')
    .replaceAll(CAMERA_FOG, HELD + CAMERA_FOG)
    .replaceAll(`${MIRROR};${HELD}`, `;${HELD}rgb+=${MIRROR.slice(1)};`);
  // A mirror term left in the held sum would reflect itself: its text moved, the output refuses.
  if (lit.includes(`${MIRROR};`)) throw new Error('REFLECTION_SOURCE_OUTPUT_UNMATCHED');
  return `${lit}
var<private> reflectionSourceRgb:vec3f;
var<private> reflectionSourceHeld:bool;
struct LitSurface{@location(0) lit:vec4f,@location(1) source:vec4f,}
${ENTRY.replace('->@location(0) vec4f{', '->LitSurface{')}
 reflectionSourceHeld=false;
 let color=litSurface(pixel);
 return LitSurface(color,select(color,vec4f(reflectionSourceRgb,1.0),reflectionSourceHeld));
}`;
}
