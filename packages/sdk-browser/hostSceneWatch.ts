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
}

/** La pose LOCALE d'un nœud, sa visibilité, et sa matrice posée quand il ne la recompose pas.
 *  Rien de monde : une matrice monde est un produit de locales, et c'est la locale que l'hôte
 *  écrit. Comparer les locales évite de remonter quoi que ce soit tant que rien n'a bougé. */
function readLocal(node: THREE.Object3D, push: (value: number) => void) {
  push(node.position.x);
  push(node.position.y);
  push(node.position.z);
  push(node.quaternion.x);
  push(node.quaternion.y);
  push(node.quaternion.z);
  push(node.quaternion.w);
  push(node.scale.x);
  push(node.scale.y);
  push(node.scale.z);
  push(node.visible ? 1 : 0);
  push(node.matrixAutoUpdate ? 1 : 0);
  // Un nœud qui ne recompose pas sa matrice la porte lui-même : c'est elle que l'hôte a écrite.
  if (node.matrixAutoUpdate) return;
  const elements = node.matrix.elements;
  for (let i = 0; i < 16; i++) push(elements[i]);
}

/** Ce que le moteur dessine, vu d'ici : chaque entrée nomme le nœud source dont elle sort. Une page
 *  d'une racine de sélection, un maillage mélangé hors DAG : la même clé, le même traitement. */
export type WatchedSources = ReadonlyArray<unknown>;

/** Le nœud source d'une entrée, quand elle en nomme un. */
function sourceOf(entry: unknown) {
  const shaped = entry as { sourceMesh?: THREE.Object3D } | undefined | null;
  return shaped ? shaped.sourceMesh : undefined;
}

/** Remonte la chaîne d'un nœud jusqu'à la racine : la pose d'un ancêtre est celle du nœud. */
function withAncestors(node: THREE.Object3D | undefined, into: Set<THREE.Object3D>) {
  let walk: THREE.Object3D | null = node ?? null;
  while (walk && !into.has(walk)) {
    into.add(walk);
    walk = walk.parent;
  }
}

/**
 * Ce que l'hôte peut écrire dans le graphe source sans passer par le moteur.
 *
 * Le contrat l'autorise à déplacer un nœud (`mesh.position.x = 100`), à le cacher, à changer
 * l'intensité ou la pose d'une lampe. Aucune API du moteur n'est appelée : aucune révision ne
 * l'annonce, et une image tenue sur ces révisions montrerait une scène périmée. La seule façon
 * honnête de le savoir est de relire ce que le contrat laisse écrire et de le comparer à ce que la
 * dernière image a lu.
 *
 * Ce qui est relu est borné deux fois. Par les NŒUDS SOURCE d'abord : une racine de sélection
 * répliquée — une instance — dérive de son modèle, et c'est le modèle qui est relu, une seule fois,
 * quel que soit le nombre de copies. Par la pose LOCALE ensuite : aucune matrice monde n'est
 * remontée ni multipliée pour savoir si quelque chose a bougé, puisqu'une matrice monde est un
 * produit de locales. Tant que rien n'a changé, l'image ne paie qu'une comparaison par nœud source.
 *
 * La comparaison est exacte — les valeurs sont gardées, pas une empreinte — et idempotente : elle
 * compare un état à celui qu'elle garde, si bien qu'une écriture passée par l'API du moteur, qui a
 * déjà incrémenté la révision de scène, n'en déclenche pas une seconde.
 */
export function createHostSceneWatch() {
  let watched: THREE.Object3D[] = [],
    lights: THREE.Light[] = [],
    held = new Float64Array(0),
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
  return {
    /**
     * Pose la liste des nœuds relus : les modèles source de ce que le moteur dessine, les lampes,
     * et les ancêtres des uns et des autres. À rappeler quand la scène change de forme — une
     * instance de plus, une lampe posée après coup —, jamais par image.
     */
    observe(source: THREE.Object3D, drawn: WatchedSources) {
      const set = new Set<THREE.Object3D>();
      lights = [];
      source.traverse((object) => {
        if ((object as THREE.Light).isLight) {
          const light = object as THREE.Light;
          lights.push(light);
          withAncestors(light, set);
          withAncestors((light as THREE.DirectionalLight).target, set);
        }
      });
      // Deux instances du même modèle nomment le même nœud : l'ensemble est celui des modèles,
      // pas celui des copies, et douze instances ne coûtent qu'une lecture.
      for (const entry of drawn) withAncestors(sourceOf(entry), set);
      // Sans racine ni lampe déclarée, il n'y a rien à relire : le graphe entier n'est pas un défaut.
      if (!set.size) withAncestors(source, set);
      // L'état gardé n'est pas retiré : reposer la même liste ne doit pas annoncer un changement,
      // sans quoi chaque annonce en provoquerait une autre et la scène ne se tairait jamais. Une
      // liste réellement différente change le nombre de valeurs relues, que la comparaison voit.
      watched = [...set];
    },
    /** Dit si l'hôte a écrit un des nœuds relus depuis la lecture précédente. Ne remonte rien. */
    changed() {
      at = 0;
      for (let i = 0; i < watched.length; i++) readLocal(watched[i], push);
      for (let i = 0; i < lights.length; i++) readLight(lights[i], push);
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
