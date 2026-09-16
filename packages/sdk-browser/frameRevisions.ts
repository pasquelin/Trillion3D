/**
 * Les trois révisions d'une image, et le témoin qui dit si l'image suivante peut être tenue.
 *
 * Chaque compteur est incrémenté à l'origine du changement — là où la scène, la vue ou les
 * ressources sont réellement écrites — et jamais déduit d'un parcours : un parcours pour savoir s'il
 * faut parcourir coûte ce qu'il prétend éviter. Les trois sont séparés parce que les étapes d'une
 * image n'en lisent pas les mêmes : une boîte monde ne dépend que de `scene` et `resources`, son
 * rectangle d'écran dépend des trois.
 */
export interface FrameRevisions {
  /** Matrices monde, matériaux, géométrie source, lampes : tout ce que la scène porte. */
  scene: number;
  /** Caméra, projection, résolution et réglages de qualité : tout ce que le point de vue porte. */
  view: number;
  /** Arrivée ou éviction de page, téléversement de texture, résidence, tampons. */
  resources: number;
}

export const createFrameRevisions = (): FrameRevisions => ({ scene: 1, view: 1, resources: 1 });

export const bumpScene = (revisions: FrameRevisions) => {
  revisions.scene++;
};
export const bumpView = (revisions: FrameRevisions) => {
  revisions.view++;
};
export const bumpResources = (revisions: FrameRevisions) => {
  revisions.resources++;
};

export type FrameHold = ReturnType<typeof createFrameHold>;

/**
 * Le témoin d'une image tenue : les trois révisions de la dernière image produite, et la signature
 * de ce qu'elle a produit.
 *
 * `stable` n'est vrai qu'après deux images consécutives dont les révisions ET la signature sont
 * identiques. C'est la seule façon honnête de couvrir les états qui convergent d'image en image sans
 * qu'aucune écriture ne les annonce — l'historique d'occulteurs, la pyramide temporelle, les
 * verdicts d'occultation relus avec un retard. Deux images qui ont produit exactement le même
 * travail en produiraient une troisième identique ; une seule ne prouve rien.
 *
 * Rien n'oublie ce témoin sans dire pourquoi : ce qui change l'image incrémente la révision qui
 * nomme ce qu'il a changé, et `same` devient faux du même coup.
 */
export function createFrameHold(values: number) {
  const held = new Float64Array(values);
  /** Là où l'appelant écrit la signature de l'image qu'il vient de produire. */
  const sample = new Float64Array(values);
  let scene = -1,
    view = -1,
    resources = -1,
    stable = false;
  // Aucune image retenue : les trois révisions gardées valent `-1`, qu'aucun compteur n'atteint.
  const same = (revisions: FrameRevisions) =>
    scene === revisions.scene && view === revisions.view && resources === revisions.resources;
  return {
    sample,
    /** Vrai quand les révisions n'ont pas bougé depuis l'image retenue. */
    same,
    /** Vrai quand les deux dernières images retenues ont produit exactement le même travail. */
    get stable() {
      return stable;
    },
    /** Range l'image qui vient d'être produite : ses révisions et sa signature. */
    keep(revisions: FrameRevisions) {
      let repeated = same(revisions);
      for (let i = 0; repeated && i < values; i++) repeated = held[i] === sample[i];
      stable = repeated;
      held.set(sample);
      scene = revisions.scene;
      view = revisions.view;
      resources = revisions.resources;
    },
  };
}
