/**
 * L'écriture du RELEVÉ : ce que la carte rapporte au processeur, et le plafond qui le borne.
 *
 * Le relevé est la seule chose qu'une image fasse redescendre de la carte. Le masque de dessin, lui,
 * reste sur place — le raster de calcul le lit là où `dagMask` l'a posé —, si bien que ce qui passe
 * ici ne sert jamais à dessiner : il sert à DIFFUSER. C'est de lui que l'hôte tire les pages qu'il
 * doit charger, épingler ou rendre au cache.
 *
 * Le plafond (`SELECTION_LIST_CAP`, `gpuDagLayout.ts`) borne ce que la copie d'image emporte. Un
 * rang refusé pose le bit 0 : le relevé est alors TRONQUÉ, et l'image le refuse en entier plutôt que
 * de l'adopter amputé. Les totaux d'image, eux, ne perdent rien — ils décrivent la coupe, pas la
 * liste qui la rapporte (`gpuDagTotalsWgsl.ts`).
 */
export const DAG_RELEVE_WGSL = `fn emitOne(page:u32){
 let slot=atomicAdd(&out.count,1u);
 if(slot>=uni.listCap){atomicOr(&out.overflow,1u);return;}
 out.pages[slot]=page;
}
`;
