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

/** Le quartet d'adressage d'une carte, tel que la fiche le porte. */
export const quartet = (nom: keyof typeof WRAP_MAP) => `wrapOf(page.wrapModes,${WRAP_MAP[nom]}u)`;

/** La lecture d'atlas d'une carte : son slot, SON quartet, les dérivées du pixel. */
export const lecture = (fn: string, nom: keyof typeof WRAP_MAP) =>
  `${fn}(page.${CARTE[nom]},uv,${quartet(nom)},ddx,ddy)`;

/** Le corps n'est exécuté que si la carte existe : le slot 0 est l'absence de texture. */
export const siCarte = (nom: keyof typeof WRAP_MAP, corps: string) =>
  `if(page.${CARTE[nom]}!=0u){${corps}}`;

/**
 * La lecture d'une carte de données qui peut être la MÊME texture qu'une carte déjà lue — un glTF
 * range rugosité, métal et occlusion dans une seule image —, au même adressage : la valeur déjà lue
 * est reprise telle quelle, bit pour bit, au lieu de refaire la chaîne d'indirection du pool. Le
 * résultat est le même que trois lectures ; seul le coût change (2,8 → 6,5 ms de passe matériaux à
 * 2496×1404 sur Emerald quand chaque carte relisait sa table).
 */
export const lectureDonnee = (
  variable: string,
  nom: keyof typeof WRAP_MAP,
  dejaLues: readonly [variable: string, nom: keyof typeof WRAP_MAP][],
) => {
  const reprises = dejaLues
    .map(
      ([lue, autre]) =>
        `if(page.${CARTE[nom]}==page.${CARTE[autre]}&&${quartet(nom)}==${quartet(autre)}){${variable}=${lue};}else `,
    )
    .join('');
  return siCarte(nom, `${reprises}{${variable}=${lecture('dataSample', nom)};}`);
};
