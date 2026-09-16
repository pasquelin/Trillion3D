import * as THREE from 'three';

const finite = (value: number | undefined) => (Number.isFinite(value) ? (value as number) : 0);

/** Les nombres d'une lampe que les moteurs relisent, dans l'ordre, quel que soit son type. Une
 *  propriété qu'un type ne porte pas vaut zéro : la place reste la même pour toutes les lampes. */
function readLight(light: THREE.Light, push: (value: number) => void) {
  const shaped = light as THREE.Light & {
    distance?: number;
    decay?: number;
    angle?: number;
    penumbra?: number;
    groundColor?: THREE.Color;
  };
  push(light.color.r);
  push(light.color.g);
  push(light.color.b);
  push(light.intensity);
  push(finite(shaped.distance));
  push(finite(shaped.decay));
  push(finite(shaped.angle));
  push(finite(shaped.penumbra));
  const ground = shaped.groundColor;
  push(ground ? ground.r : 0);
  push(ground ? ground.g : 0);
  push(ground ? ground.b : 0);
  // La cible d'une lampe directionnelle ou conique porte sa direction, et vit souvent hors du
  // graphe source : sa position monde est relue avec la lampe, jamais par la traversée.
  const target = (light as THREE.DirectionalLight).target as THREE.Object3D | undefined;
  if (!target) {
    push(0);
    push(0);
    push(0);
    return;
  }
  target.updateWorldMatrix(true, false);
  const elements = target.matrixWorld.elements;
  push(elements[12]);
  push(elements[13]);
  push(elements[14]);
}

/**
 * Ce que l'hôte peut écrire dans le graphe source sans passer par le moteur.
 *
 * Le contrat autorise l'hôte à déplacer un nœud (`mesh.position.x = 100`), à le cacher, à changer
 * l'intensité ou la pose d'une lampe. Aucune API du moteur n'est appelée : aucune révision ne
 * l'annonce, et une image tenue sur ces révisions montrerait une scène périmée. La seule façon
 * honnête de le savoir est de relire ce que le contrat laisse écrire et de le comparer à ce que la
 * dernière image a lu.
 *
 * La relecture est exacte — les valeurs sont gardées, pas une empreinte — et bornée par le nombre
 * de nœuds et de lampes du graphe, jamais par le nombre de pages : une scène d'un million de pages
 * sous un millier de nœuds coûte un millier de comparaisons. Elle est idempotente par construction :
 * elle compare un état à celui qu'elle garde, si bien qu'une écriture passée par l'API du moteur,
 * qui a déjà incrémenté la révision de scène, n'en déclenche pas une seconde.
 */
export function createHostSceneWatch() {
  let held = new Float64Array(0),
    sample = new Float64Array(256),
    count = -1,
    at = 0;
  const push = (value: number) => {
    if (at === sample.length) {
      const grown = new Float64Array(sample.length * 2);
      grown.set(sample);
      sample = grown;
    }
    sample[at++] = value;
  };
  const read = (object: THREE.Object3D) => {
    const elements = object.matrixWorld.elements;
    for (let i = 0; i < 16; i++) push(elements[i]);
    push(object.visible ? 1 : 0);
    if ((object as THREE.Light).isLight) readLight(object as THREE.Light, push);
  };
  return {
    /**
     * Remonte les matrices monde du graphe, le relit, et dit si l'hôte l'a écrit depuis la lecture
     * précédente. La toute première lecture rend vrai : rien n'est encore connu de ce graphe.
     */
    changed(source: THREE.Object3D) {
      source.updateMatrixWorld(true);
      at = 0;
      source.traverse(read);
      let moved = at !== count;
      for (let i = 0; !moved && i < at; i++) moved = held[i] !== sample[i];
      if (moved) {
        if (held.length < at) held = new Float64Array(sample.length);
        held.set(sample.subarray(0, at));
        count = at;
      }
      return moved;
    },
  };
}
