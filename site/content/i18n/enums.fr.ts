import type { LocaleOverlay } from './entryOverlay.ts';

export const enumsFr: LocaleOverlay = {
  IDENTITY_MATRIX4: {
    description:
      'Identité en ordre colonne, lue sans jamais être modifiée : pose d’un nœud ou d’une racine sans pose.',
    values: [{ desc: 'Seize nombres, en ordre colonne.' }],
  },
  DiagnosticMode: {
    description:
      'Ce que dessine une image. La disponibilité décrit les sorties réelles du pipeline, jamais des surcouches artificielles.',
    values: [
      { desc: 'Image éclairée issue des matériaux glTF.' },
      { desc: 'Une couleur pleine unique par triangle soumis, sans lignes.' },
      {
        desc: 'Identité stable primitive/page, une couleur par grappe ; WebGL2 et WebGPU tous les deux.',
      },
      {
        desc: 'Grappes de niveau 0 face aux réductions plus grossières réellement choisies dans cette image.',
      },
      { desc: 'Erreur de chaque grappe projetée par sa sphère, telle que la coupe l’emploie.' },
      {
        desc: 'Une couleur par classe de matériau : la passe de classe qui a résolu le pixel. Chemin de visibilité WebGPU seulement.',
      },
      {
        desc: 'Pages visibles sélectionnées ; les nœuds hiérarchiques rejetés sont comptés, pas dessinés.',
      },
      {
        desc: 'Pages d’indices attachées ; les pages absentes ne sont pas dessinées. Ce n’est pas la VRAM physique.',
      },
      { desc: 'Indisponible : la résidence des mips de texture n’est pas instrumentée.' },
      { desc: 'Indisponible : aucun compteur de fragments.' },
    ],
  },
  LodQualityId: {
    description:
      'Préréglages de LOD à l’exécution. `pixelError` est le seuil écran consommé par la sélection de grappes exactes ; `0` conserve les feuilles exactes.',
    values: [
      { desc: 'Détail source maximal : `pixelError: 0`, anisotropie source.' },
      { desc: 'Haute qualité : `pixelError: 1`, anisotropie maximale.' },
      { desc: 'Équilibré : `pixelError: 4`.' },
      {
        desc: 'Adaptatif : `pixelError: 2`, augmenté avec la vitesse de caméra ; une vue immobile conserve la base.',
      },
    ],
  },
  ScreenErrorVariant: {
    description:
      'Projection de l’erreur de grappe comparée au seuil. Cet état de module est lu par la métrique CPU et intégré au shader de sélection à sa compilation. Source publique : Karis, Stubbe et Wihlidal, SIGGRAPH 2021.',
    values: [
      { desc: 'Notre borne, par défaut : elle ne sous-estime jamais l’erreur.' },
      { desc: 'Formule publiée, utilisée par le banc comparatif.' },
    ],
  },
  MathPathMode: {
    description:
      'Chemin exécuté par un lot. En `auto`, le gouverneur compare les médianes glissantes en nanosecondes par élément et ne bascule qu’après plusieurs exécutions favorables ; JS reste la référence et le repli.',
    values: [
      { desc: 'Arbitrage par la mesure, valeur par défaut.' },
      { desc: 'Chemin JavaScript imposé pour une campagne.' },
      { desc: 'Noyau WebAssembly imposé lorsqu’il existe pour cette opération.' },
    ],
  },
  JobStatus: {
    description:
      'Cycle de vie d’une tâche créée par `createJob`. Une tâche annulée ou échouée libère le résultat qu’elle possédait.',
    values: [
      { desc: 'Créée, pas encore démarrée.' },
      { desc: 'En cours ; les événements `progress` portent une phase et un compte.' },
      { desc: 'Terminée ; `result` contient la valeur.' },
      { desc: 'Interrompue par son `AbortSignal`.' },
      { desc: 'Échec ; `error` contient `{ code, message }`.' },
    ],
  },
  CapabilityTier: {
    description:
      'Niveau que la politique de sûreté autorise pour une session selon les coûts mesurés. Une `SafetyDecision` indique le niveau, l’activation, la raison et la date du changement.',
    values: [
      { desc: 'Tous les coûts mesurés respectent le budget.' },
      { desc: 'Un budget est dépassé : la fonction est réduite.' },
      { desc: 'Chemin sûr, fonction désactivée.' },
    ],
  },
  GpuTimingMethod: {
    description:
      'Méthode de mesure des durées GPU. Une durée par passe localise le coût sans le quantifier : sur un GPU en tuiles, les passes se chevauchent. Le total de l’image est l’enveloppe `gpuImageMs` et les étapes ne s’additionnent pas.',
    values: [
      { desc: 'Requêtes d’horodatage WebGPU natives.' },
      { desc: 'Extension WebGL2 utilisée sur ce chemin.' },
    ],
  },
  ColumnKind: {
    description:
      'Stockage d’une colonne du manifeste binaire. `COLUMN_KIND` associe chaque nom de colonne à son type afin de choisir la vue sur les octets annexes.',
    values: [
      { desc: 'Bornes, sphères, erreurs et nœuds d’élimination.' },
      { desc: 'Indices signés : pages et niveaux de groupe.' },
      { desc: 'Compteurs et décalages non signés.' },
      { desc: 'Octets bruts : objets SHA et pixels d’aperçu.' },
    ],
  },
  Side: {
    description:
      'Faces dessinées d’une surface. Chaque décision de raster, cône, pipeline et mélange compare cette valeur. `sideOf` lit la déclaration du matériau hôte à la frontière d’import ; `materialSide` redonne la constante hôte pour les matériaux de diagnostic.',
    values: [
      { desc: 'Faces avant uniquement ; un tableau de matériaux vide donne ce choix.' },
      { desc: 'Faces arrière uniquement.' },
      { desc: 'Les deux, pour feuilles, tissus et découpes fines.' },
    ],
  },
};
