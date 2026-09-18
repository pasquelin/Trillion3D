import { WRAP_MAP } from './visibilityWrapModes.ts';

/**
 * Ce que chaque carte de `WRAP_MAP` donne à sa lecture : son slot dans la fiche de page. Un rang
 * ajouté à `WRAP_MAP` sans son entrée ici ne compile pas ; sans cette table, une septième carte se
 * serait lue en serrage sans que rien ne le signale.
 */
const CARTE = {
  base: 'mapIndex',
  rough: 'roughnessIndex',
  metal: 'metalnessIndex',
  normal: 'normalIndex',
  ao: 'aoIndex',
  emissive: 'emissiveIndex',
} as const satisfies Record<keyof typeof WRAP_MAP, string>;

/** La lecture d'atlas d'une carte : son slot, SON quartet, les dérivées du pixel. */
export const lecture = (fn: string, nom: keyof typeof WRAP_MAP) =>
  `${fn}(page.${CARTE[nom]},uv,wrapOf(page.wrapModes,${WRAP_MAP[nom]}u),ddx,ddy)`;

/** Le corps n'est exécuté que si la carte existe : le slot 0 est l'absence de texture. */
export const siCarte = (nom: keyof typeof WRAP_MAP, corps: string) =>
  `if(page.${CARTE[nom]}!=0u){${corps}}`;

/** Le retour d'image des six cartes, pour le pixel dont c'est la phase : ce que la fiche nomme. */
export const retour = (Object.keys(CARTE) as (keyof typeof WRAP_MAP)[])
  .map((nom) =>
    siCarte(
      nom,
      lecture(nom === 'base' || nom === 'emissive' ? 'colorFeedback' : 'dataFeedback', nom) + ';',
    ),
  )
  .join('');
