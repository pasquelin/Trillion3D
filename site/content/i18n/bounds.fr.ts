export const boundsFr = {
  boxUnion: {
    description:
      'Une boîte est formée de six nombres consécutifs : trois bornes basses puis trois hautes. Une boîte vide place ses bornes basses à `+Infinity` et ses bornes hautes à `-Infinity`. L’extension et l’union reçoivent directement les bornes et ne créent donc aucun objet temporaire.',
  },
  boxTransform: {
    description:
      'La boîte qui contient l’image de `box` par `m` est l’union de ses huit coins transformés. Une boîte vide reste inchangée et `out` peut être `box`, car les bornes sont lues avant la première écriture. `boxCornersInto` écrit les huit coins à plat, soit vingt-quatre nombres.',
  },
  sphereFromBounds: {
    description:
      'La sphère englobante d’une boîte, écrite à partir de `o` : centre `x, y, z`, puis rayon. Le centre vaut `(min + max) * 0.5` et le rayon la moitié de la diagonale. Une boîte vide produit une sphère vide, centrée en zéro et de rayon `-1`.',
  },
  frustumPlanesFromMatrix: {
    description:
      'Les six plans du frustum d’une matrice de clip. La première fonction les normalise pour obtenir une distance signée ; la seconde conserve les sommes et différences brutes des lignes, dont seul le signe décide, comme le test de clip exact. Une matrice dégénérée produit des plans NaN ou infinis sans lever d’exception.',
  },
  frustumFarPlane: {
    description:
      'Le plan lointain d’un frustum dont la projection n’en possède pas. La projection du moteur est infinie : le plan est donc lu dans la matrice de vue. Une distance `far` non finie laisse un plan nul, réellement sans limite. `frustumPlanesToLocal` transporte les plans dans l’espace local d’une transformation.',
  },
  frustumExcludesBox: {
    description:
      'Teste une boîte contre le frustum. La première fonction vaut vrai lorsqu’un plan laisse les huit coins derrière lui. La seconde renvoie 0 hors champ, 1 à cheval ou 2 entièrement dedans. Un sous-arbre entièrement dedans évite de retester toutes ses boîtes.',
  },
  boxConeRejects: {
    description:
      'Rejette une boîte locale avec son cône de normales vu depuis un point monde. La boîte devient une sphère, l’axe est transporté par la matrice normale puis normalisé. Un cône d’angle ≥ `HALF_PI` ne rejette jamais ; un paramètre refusé non plus. Les variantes `_WGSL` partagent les constantes du shader.',
  },
};
