import type { LocaleOverlay } from './entryOverlay.ts';

export const cameraFr: LocaleOverlay = {
  perspectiveProjection: {
    description:
      'Projection perspective d’une caméra : `fov` vertical en degrés, ratio `aspect`, plan proche `near` et zoom. **Profondeur inversée, plan lointain infini** : `near` se projette à 1 et l’infini à 0. Aucun plan lointain n’intervient, ce qui préserve la précision en profondeur.',
  },
  createCameraFrame: {
    description:
      'Crée les matrices d’une image caméra, allouées une fois puis réécrites à chaque image : `view`, `viewProjection` et les six plans normalisés du frustum.',
  },
  updateCameraFrame: {
    description:
      'Réécrit l’image caméra : vue inverse de `world`, vue-projection égale à `projection · view`, puis les six plans. `far` est déclaré par l’hôte : la projection reste infinie, tandis que le frustum conserve cette limite. Omis ou non fini, le plan reste sans limite.',
  },
  worldToRenderOrigin: {
    description:
      'Écrit `world` en ramenant sa translation à `origin`. La soustraction se fait avec la précision des entrées et l’arrondi simple précision n’arrive qu’à l’écriture GPU. `at` désigne le premier des seize nombres écrits.',
  },
  matrixAtRenderOrigin: {
    description:
      'Écrit `m · T(origin)`. Seule la quatrième colonne change ; elle vaut `m · (origin, 1)`, calculé avec la précision des entrées avant l’arrondi d’écriture.',
  },
  viewToRenderOrigin: {
    description:
      'Écrit `view` sans sa translation : la vue d’une caméra de même orientation placée à l’origine du repère de rendu, contrepartie exacte de `worldToRenderOrigin`.',
  },
  createEngineCamera: {
    description:
      'Crée une `EngineCamera` : image caméra plus `world`, `projection`, `eye`, `near`, `far`, `fov` et `aspect`, chaque tampon étant alloué une seule fois. Aucun objet de l’hôte n’entre dans le moteur.',
  },
  writeEngineCamera: {
    description:
      'Calcule tout ce que lit une image à partir de `into.world` déjà posé et des paramètres optiques déclarés.',
  },
  defaultEngineCamera: {
    description:
      'Caméra à l’origine, fov 50, aspect 1, proche 0,1, lointain 2000 et zoom 1 : le repli des oracles appelés avant la première image.',
  },
  readCameraWorld: {
    description:
      'Résout les ancêtres de la caméra hôte, copie sa matrice monde puis applique `writeEngineCamera`. C’est l’unique traduction depuis la caméra hôte, une fois par image. Les profondeurs de clip `[-1, 1]` et `[0, 1]` sont respectées.',
  },
  holdCameraWorld: { description: 'Copie bit pour bit une caméra moteur, sans rien recalculer.' },
  enginePose: {
    description: 'Lit la position et la rotation de l’image dessinée depuis la caméra moteur.',
  },
};
