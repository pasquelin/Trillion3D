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
 *
 * Les deux passes qui éclairent reçoivent exactement ce code, sur exactement une liaison : le proxy
 * résident et ses réglages tiennent dans un seul tampon de stockage (`residentProxyWgsl`), si bien
 * qu'une surface de mélange lointaine est ombrée par le même rayon qu'une surface opaque. Il n'y a
 * plus de bouchon, plus de chemin qui rende un sans avoir cherché.
 */
/** Le rang de la liaison du proxy résident dans la disposition de la résolution différée. */
export const SUN_FAR_PROXY_BINDING = 13;

export const SUN_FAR_SHADOW_WGSL = `
${BOUNCE_TRACE_WGSL}
/**
 * La fraction de soleil qui atteint un point qu'aucune cascade ne couvre : zéro si le proxy coupe
 * le rayon, un sinon. Le rayon part d'une maille de proxy plus loin, sans quoi la surface grossière
 * ombrerait la vraie surface qu'elle approche.
 *
 * Sans proxy dans le cache, present vaut zéro et la surface lointaine reste éclairée sans ombre,
 * exactement comme avant ce lot : l'indisponibilité est dite dans le diagnostic, jamais comblée par
 * une ombre inventée ni par une cascade étirée qui diviserait par cinq la densité des ombres proches.
 *
 * Les deux compteurs ne montent que sur les images relevées : sur les autres, la passe mesurée ne
 * porte aucun diagnostic.
 */
fn sunFarShadowFactor(P:vec3f,N:vec3f,L:vec3f)->f32{
 if(proxy.present<0.5){return 1.0;}
 let counting=proxy.counting>0u;
 if(counting){atomicAdd(&proxy.tested,1u);}
 // Le rayon part d'une maille de proxy plus loin le long de sa propre direction : c'est ce départ,
 // et non un relèvement massif le long de la normale, qui saute la surface grossière sur laquelle
 // le point se tient. Le relèvement, lui, ne sert qu'à quitter son plan exact.
 let origin=P+N*proxy.offsetMetres+L*proxy.startMetres;
 if(!proxyBlocked(origin,L,max(proxy.maxMetres-proxy.startMetres,0.0))){return 1.0;}
 if(counting){atomicAdd(&proxy.blocked,1u);}
 return 0.0;
}`;
