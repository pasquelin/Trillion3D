import { createFrameGateCore } from './frameGateCore.ts';

/** Ce qu'une image WebGL a produit d'observable : voir `keep` ci-dessous. */
const WEBGL_HOLD_VALUES = 6;

export type WebglFrameGate = ReturnType<typeof createWebglFrameGate>;

/**
 * La porte d'image des moteurs rendus par Three : le noyau commun (`frameGateCore.ts`), et la seule
 * chose qui leur appartienne en propre, la signature de l'image qu'ils viennent de produire.
 *
 * Un moteur WebGL ne soumet rien lui-même — l'hôte rend le graphe qu'il tient. Une image tenue n'a
 * donc rien à réémettre : la scène attachée EST déjà l'image, et ne rien faire la redonne au pixel
 * près. Ce qui est supprimé est la coupe, la remontée des matrices et la mise à jour des lampes.
 */
export function createWebglFrameGate() {
  const core = createFrameGateCore(WEBGL_HOLD_VALUES);
  // Le noyau est complété, jamais recopié : un étalement figerait la valeur de ses accesseurs.
  return Object.assign(core, {
    /**
     * Range l'image qui vient d'être produite. Les six nombres décrivent la COUPE, et rien du
     * parcours qui l'a trouvée : deux images qui les partagent ont attaché exactement les mêmes
     * clusters, dans le même ordre, donc dessinent la même image.
     *
     * L'identité de la coupe est le hachage des identifiants affichés, pas un compteur de parcours.
     * Un rejet par le tronc compte des nœuds visités : le repli par forçage redescend l'arbre et en
     * comptait deux fois, si bien que deux images à coupe identique paraissaient différentes et
     * qu'une pose immobile ne convergeait jamais.
     */
    keep(
      visible: number,
      selectedTriangles: number,
      shown: ReadonlyArray<{ id: number }>,
      lodLevel: number,
      overBudget: boolean,
    ) {
      let digest = shown.length;
      for (let i = 0; i < shown.length; i++) digest = (Math.imul(digest, 31) + shown[i].id) | 0;
      const sample = core.hold.sample;
      sample[0] = visible;
      sample[1] = selectedTriangles;
      sample[2] = digest;
      sample[3] = lodLevel;
      sample[4] = shown.length;
      sample[5] = overBudget ? 1 : 0;
      core.hold.keep(core.revisions);
    },
  });
}
