import { BOUNCE_GRID_WGSL, INVERSE_PI_WGSL } from './bounceGridWgsl.ts';

/**
 * L'application du rebond, aux liaisons que la passe appelante lui donne : la résolution différée
 * opaque et la passe de mélange lisent les mêmes sondes, avec la même loi, depuis deux dispositions
 * de liaisons différentes. Une seule implémentation, jamais deux.
 *
 * L'irradiance interpolée des sondes multiplie l'albédo diffus du pixel, divisé par π : c'est la
 * même loi de Lambert que le direct, avec la même implémentation de référence. Le terme est
 * strictement additif au direct — émission, direct et indirect sont partitionnés (P3) — et il vaut
 * exactement zéro là où aucune sonde ne voit le point, ce qui interdit une fuite à travers un mur.
 *
 * Un métal pur n'a pas d'albédo diffus : sa part indirecte est nulle, comme dans le direct. Le
 * spéculaire indirect n'est pas de ce lot, et son absence est déclarée plutôt que devinée.
 */
export function bounceApplyWgsl(grid: number, probes: number): string {
  return `
@group(0) @binding(${grid}) var<uniform> bounce:BounceGrid;
@group(0) @binding(${probes}) var<storage,read> probes:array<vec4f>;
${BOUNCE_GRID_WGSL}
${INVERSE_PI_WGSL}
/** La radiance diffuse qu'un pixel renvoie de la lumière qui a rebondi avant de l'atteindre. */
fn bounceLighting(rgb:vec3f,metal:f32,N:vec3f,P:vec3f,ao:f32)->vec3f{
 return rgb*(1.0-metal)*INVERSE_PI*sampleBounce(P,N)*ao;
}`;
}

/** L'application du rebond aux liaisons de la résolution différée, et ses deux vues de mesure. */
export const BOUNCE_APPLY_WGSL = `${bounceApplyWgsl(11, 12)}
/** Vrai quand l'hôte a demandé la vue de diagnostic d'irradiance indirecte, et elle seule. */
fn bounceOnly()->bool{return bounce.reach.y>0.5;}
/**
 * L'irradiance indirecte nue du pixel, multipliée par l'exposition : c'est ce que le harnais
 * compare à l'oracle du compilateur. Ni albédo, ni ACES, ni sRGB — une image à mesurer, pas une
 * image à regarder, et l'exposition n'est là que pour la faire tenir dans les huit bits de la
 * capture. Une valeur au-delà de un est écrêtée, et le harnais compte ce qu'elle a écrêté.
 */
fn bounceIrradiance(N:vec3f,P:vec3f,exposure:f32)->vec3f{return sampleBounce(P,N)*exposure;}`;
