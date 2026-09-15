import * as THREE from 'three';

/** Browser adapter: world-space light data, independent of material evaluation. */
function sceneLights(source: THREE.Object3D): THREE.Light[] {
  const lights: THREE.Light[] = [];
  source.traverse((object) => {
    if ((object as THREE.Light).isLight) lights.push(object as THREE.Light);
  });
  return lights;
}
function visible(light: THREE.Light) {
  let node: THREE.Object3D | null = light;
  while (node) {
    if (!node.visible) return false;
    node = node.parent;
  }
  return true;
}
/**
 * Recopie dans la scène de rendu les lampes que le graphe source déclare, et rien d'autre.
 *
 * Aucune lumière sans source déclarée (P6) : une source qui n'en porte aucune donne une scène sans
 * lampe, pas une hémisphérique et un soleil inventés. C'est la même règle que le chemin du contrat,
 * du côté des adaptateurs qui rendent par Three.
 */
export function installSceneLighting(
  scene: THREE.Scene,
  source: THREE.Object3D,
  clearColor: number,
) {
  scene.background = new THREE.Color(clearColor);
  let pairs: Array<{ original: THREE.Light; copy: THREE.Light; target?: THREE.Object3D }> = [];
  const update = () => {
    for (const { original, copy, target } of pairs) {
      original.updateWorldMatrix(true, false);
      copy.position.setFromMatrixPosition(original.matrixWorld);
      copy.quaternion.identity();
      copy.scale.set(1, 1, 1);
      copy.color.copy(original.color);
      copy.intensity = original.intensity;
      copy.visible = visible(original);
      if (target) {
        const sourceTarget = (original as THREE.DirectionalLight).target;
        sourceTarget.updateWorldMatrix(true, false);
        target.position.setFromMatrixPosition(sourceTarget.matrixWorld);
      }
      if (original instanceof THREE.HemisphereLight)
        (copy as THREE.HemisphereLight).groundColor.copy(original.groundColor);
      if (original instanceof THREE.PointLight || original instanceof THREE.SpotLight) {
        (copy as THREE.PointLight).distance = original.distance;
        (copy as THREE.PointLight).decay = original.decay;
      }
      if (original instanceof THREE.SpotLight) {
        (copy as THREE.SpotLight).angle = original.angle;
        (copy as THREE.SpotLight).penumbra = original.penumbra;
      }
    }
  };
  const refresh = () => {
    for (const { copy, target } of pairs) {
      scene.remove(copy);
      if (target) scene.remove(target);
    }
    pairs = [];
    for (const original of sceneLights(source)) {
      const copy = original.clone();
      let target: THREE.Object3D | undefined;
      if ('target' in original) {
        target = new THREE.Object3D();
        (copy as THREE.DirectionalLight).target = target;
        scene.add(target);
      }
      scene.add(copy);
      pairs.push({ original, copy, target });
    }
    update();
  };
  refresh();
  return {
    update,
    refresh,
    /** Vrai dès qu'une lampe du graphe source est installée : le seul signal de la vue éclairée. */
    get lit() {
      return pairs.length > 0;
    },
  };
}

/**
 * Ce qu'un moteur rendu par Three publie de son éclairage : de quoi le rafraîchir, et la vue qu'il
 * rend. Sans lampe installée, l'hôte compose par l'identité plutôt que par l'exposition et ACES.
 *
 * `sceneLit` est une fonction et non un accesseur : les moteurs étalent cet objet dans le leur, et
 * un accesseur y serait lu une seule fois, à la construction. Une lampe posée après coup — le cas
 * de tout hôte du contrat — doit rallumer la chaîne d'affichage à l'image suivante.
 */
export function sceneLightingApi(
  lighting: ReturnType<typeof installSceneLighting>,
  /** Prévenu quand les lampes du graphe source changent : c'est une écriture de scène. */
  sceneChanged: () => void = () => {},
) {
  return {
    refreshSceneLighting: () => {
      lighting.refresh();
      sceneChanged();
    },
    sceneLit: () => lighting.lit,
  };
}
