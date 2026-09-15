import { BOUNCE_TRACE_WGSL } from './bounceTraceWgsl.ts';

/**
 * L'ombre du soleil au-delà de la dernière cascade, tirée contre le proxy résident de la scène.
 *
 * Les cascades couvrent une fraction publiée du lointain de la caméra ; plus loin, une surface
 * restait éclairée sans aucun test d'ombre — un intérieur vu de loin paraissait en plein jour, puis
 * devenait noir quand la caméra approchait et qu'une cascade le reprenait. Un rayon d'ombre par
 * pixel concerné supprime cette marche : le même rayon que les sondes lancent, contre la même
 * traversée du même proxy, sans une ligne de géométrie en double.
 *
 * Le rayon est déterministe — sa direction est celle du soleil, son origine celle du pixel —, donc
 * deux images d'une caméra immobile donnent exactement la même ombre lointaine. Rien n'est accumulé
 * d'une image à l'autre : il n'y a ni retard, ni traînée, ni bruit propre à ce lot.
 *
 * Les bornes sont celles de la traversée du rebond, publiées avec elle (X2) : un rayon qui épuise
 * ses nœuds ne trouve pas d'occulteur, donc il éclaire. C'est une approximation nommée de ce lot,
 * au même titre que l'erreur géométrique certifiée du proxy, qui déplace le contour de l'ombre.
 */
export const SUN_FAR_SHADOW_WGSL = `
@group(0) @binding(13) var<storage,read> proxyTriangles:array<f32>;
@group(0) @binding(14) var<storage,read> proxyAlbedo:array<u32>;
@group(0) @binding(15) var<storage,read> proxyNodeBounds:array<f32>;
@group(0) @binding(16) var<storage,read> proxyNodeChildren:array<u32>;
/**
 * Réglages de l'ombre lointaine et ses deux compteurs. Le vecteur porte, dans l'ordre : le décalage
 * de l'origine le long de la normale, le départ du rayon le long de sa direction, la portée du
 * rayon, puis un pour un proxy résident et zéro pour aucun. Le drapeau dit si l'image est relevée.
 */
struct SunFarState{params:vec4f,counting:u32,tested:atomic<u32>,blocked:atomic<u32>,}
@group(0) @binding(17) var<storage,read_write> sunFar:SunFarState;
${BOUNCE_TRACE_WGSL}
/**
 * La fraction de soleil qui atteint un point qu'aucune cascade ne couvre : zéro si le proxy coupe
 * le rayon, un sinon. Le rayon part d'une maille de proxy plus loin, sans quoi la surface grossière
 * ombrerait la vraie surface qu'elle approche.
 *
 * Sans proxy dans le cache, params.w vaut zéro et la surface lointaine reste éclairée sans ombre,
 * exactement comme avant ce lot : l'indisponibilité est dite dans le diagnostic, jamais comblée par
 * une ombre inventée ni par une cascade étirée qui diviserait par cinq la densité des ombres proches.
 *
 * Les deux compteurs ne montent que sur les images relevées : sur les autres, la passe mesurée ne
 * porte aucun diagnostic.
 */
fn sunFarShadowFactor(P:vec3f,N:vec3f,L:vec3f)->f32{
 if(sunFar.params.w<0.5){return 1.0;}
 let counting=sunFar.counting>0u;
 if(counting){atomicAdd(&sunFar.tested,1u);}
 // Le rayon part d'une maille de proxy plus loin le long de sa propre direction : c'est ce départ,
 // et non un relèvement massif le long de la normale, qui saute la surface grossière sur laquelle
 // le point se tient. Le relèvement, lui, ne sert qu'à quitter son plan exact.
 let origin=P+N*sunFar.params.x+L*sunFar.params.y;
 if(!proxyBlocked(origin,L,max(sunFar.params.z-sunFar.params.y,0.0))){return 1.0;}
 if(counting){atomicAdd(&sunFar.blocked,1u);}
 return 0.0;
}`;
/**
 * Le bouchon des passes qui ne lient pas le proxy : l'ombre lointaine y rend un, c'est-à-dire la
 * surface éclairée sans ombre portée, exactement comme avant ce lot. C'est le cas du chemin des
 * transparents, qui n'a ni proxy lié ni liaison libre pour en recevoir un ; le manque est écrit ici
 * plutôt que deviné, et il tombera avec le lot qui portera le proxy jusqu'à cette passe.
 */
export const SUN_FAR_STUB_WGSL = 'fn sunFarShadowFactor(P:vec3f,N:vec3f,L:vec3f)->f32{return 1.0;}';
/** Les quatre réglages, le drapeau de relevé, puis les deux compteurs : la disposition du bloc. */
export const SUN_FAR_PARAM_FLOATS = 4;
export const SUN_FAR_COUNTING_OFFSET = SUN_FAR_PARAM_FLOATS * 4;
export const SUN_FAR_COUNT_OFFSET = SUN_FAR_COUNTING_OFFSET + 4;
export const SUN_FAR_COUNTS = 2;
/** Le bloc est aligné sur seize octets comme la `vec4f` qui l'ouvre : vingt-huit octets utiles. */
export const SUN_FAR_STATE_BYTES = 32;
