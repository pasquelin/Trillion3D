import * as THREE from 'three';

/**
 * Les facteurs qui écartent la réponse d'une surface de son albédo. Chacun est une propriété de
 * matériau — jamais un type d'objet, jamais un nom — et chacun est un uniforme : le mettre à zéro
 * ne recompile aucun programme, il n'annule qu'un facteur le temps d'une image.
 *
 * - `metalness` : la réponse diffuse vaut `albédo · (1 − metalness)`, donc un métal pur sort noir
 *   quelle que soit l'irradiance reçue. C'est le terme qui rendait la vue fausse.
 * - `aoMapIntensity`, `lightMapIntensity` : deux cartes qui modulent ou ajoutent de l'irradiance,
 *   et qui écriraient donc autre chose que la couleur de base.
 * - `transmission` : ce que l'on voit au travers remplace la couleur de base, éclairage ou non.
 *
 * Ce qui reste : couleur de base, carte de base, couleurs par sommet — l'albédo — et l'émission du
 * matériau, écart nommé de cette vue face au chemin WebGPU (`docs/SDK.md`).
 */
const NEUTRAL = ['metalness', 'aoMapIntensity', 'lightMapIntensity', 'transmission'] as const;
type Factors = Partial<Record<(typeof NEUTRAL)[number], number>>;

/**
 * L'albédo brut de la vue `unlit` sur un moteur rendu par Three.
 *
 * Un matériau qui répond à la lumière ne peut pas publier son albédo par la seule lumière : une
 * irradiance ambiante de π rend `albédo · (1 − metalness)`, exact pour un diélectrique et nul pour
 * un métal. La vue annule donc les facteurs ci-dessus le temps de l'image, puis rend à chaque
 * matériau la valeur qu'il portait : le graphe source ne garde aucune trace d'une image à l'autre,
 * et revenir en `lit` retrouve l'état d'avant, propriété par propriété.
 *
 * L'annulation a lieu à chaque image, dans les crochets de rendu de la scène, et non une fois pour
 * toutes : les pages entrent et sortent de la résidence entre deux images, et une conversion faite
 * à la bascule laisserait hors de la vue tout ce qui arrive après elle.
 */
export function createUnlitAlbedo(scene: THREE.Scene) {
  // Les matériaux effectivement neutralisés de l'image en cours et les valeurs qu'ils portaient,
  // dans deux tableaux réutilisés : rien n'est alloué par image, et un matériau partagé par
  // plusieurs maillages n'est retenu qu'une fois — la seconde visite ne trouve plus rien à annuler.
  const touched: Factors[] = [];
  const saved: (number | undefined)[] = [];
  let count = 0;
  const zero = (material: THREE.Material) => {
    const factors = material as Factors;
    const base = count * NEUTRAL.length;
    let changed = false;
    for (let index = 0; index < NEUTRAL.length; index++) {
      const value = factors[NEUTRAL[index]];
      saved[base + index] = value;
      if (!value) continue;
      factors[NEUTRAL[index]] = 0;
      changed = true;
    }
    if (changed) touched[count++] = factors;
  };
  const neutralise = (object: THREE.Object3D) => {
    const material = (object as THREE.Mesh).material;
    if (!material) return;
    if (Array.isArray(material)) for (const one of material) zero(one);
    else zero(material);
  };
  const before = () => {
    count = 0;
    scene.traverse(neutralise);
  };
  const after = () => {
    while (count > 0) {
      count--;
      const factors = touched[count],
        base = count * NEUTRAL.length;
      for (let index = 0; index < NEUTRAL.length; index++) {
        const value = saved[base + index];
        if (value !== undefined) factors[NEUTRAL[index]] = value;
      }
    }
  };
  let enabled = false,
    priorBefore = scene.onBeforeRender,
    priorAfter = scene.onAfterRender;
  return {
    /** Arme ou désarme la vue. Désarmer rend d'abord aux matériaux ce qu'ils portaient. */
    setEnabled(value: boolean) {
      if (value === enabled) return;
      enabled = value;
      if (value) {
        priorBefore = scene.onBeforeRender;
        priorAfter = scene.onAfterRender;
        scene.onBeforeRender = before;
        scene.onAfterRender = after;
        return;
      }
      after();
      scene.onBeforeRender = priorBefore;
      scene.onAfterRender = priorAfter;
    },
  };
}
