import * as THREE from 'three';
import { readLightInto, LIGHT_SLOTS } from './hostSceneLightState.ts';

/** Place réservée à un nœud : visibilité, drapeau de recomposition, et seize valeurs de pose — sa
 *  matrice posée, ou sa translation, sa rotation et son échelle. Une place fixe, pour que la boucle
 *  n'ait ni à mesurer ni à décaler quoi que ce soit. */
const NODE_SLOTS = 18;

/**
 * Marque d'un nœud que le moteur a créé lui-même — une copie d'instance, par exemple. L'hôte ne l'a
 * jamais reçu et ne peut donc pas l'écrire : le relire serait payer une comparaison pour une valeur
 * dont on sait qu'elle ne bouge pas.
 */
export const ENGINE_OWNED = 'webGeometryEngineOwned';

/** La pose d'un nœud qui recompose sa matrice, relue sans allocation. */
const poseScratch = new Float64Array(10);

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
 * Ce qui est relu est borné deux fois. Par les NŒUDS SOURCE d'abord : une entrée dessinée nomme le
 * nœud dont elle sort, et plusieurs entrées du même nœud ne le relisent qu'une fois. Par la pose
 * LOCALE ensuite : aucune matrice monde n'est remontée ni multipliée pour savoir si quelque chose a
 * bougé, puisqu'une matrice monde est un produit de locales.
 *
 * La lecture et la comparaison sont la même passe, dans un tableau plat, sans allocation ni appel
 * par nœud : l'image ne paie qu'une comparaison par valeur relue. La comparaison est exacte — les
 * valeurs sont gardées, pas une empreinte — et idempotente : elle compare un état à celui qu'elle
 * garde, si bien qu'une écriture passée par l'API du moteur, qui a déjà incrémenté la révision de
 * scène, n'en déclenche pas une seconde.
 */
export function createHostSceneWatch() {
  let watched: THREE.Object3D[] = [],
    lights: THREE.Light[] = [],
    held = new Float64Array(0),
    posed = false;
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
      for (const entry of drawn) withAncestors(sourceOf(entry), set);
      for (const node of set) if (node.userData[ENGINE_OWNED]) set.delete(node);
      // Sans racine ni lampe déclarée, il n'y a rien à relire : le graphe entier n'est pas un défaut.
      if (!set.size) withAncestors(source, set);
      watched = [...set];
      const need = watched.length * NODE_SLOTS + lights.length * LIGHT_SLOTS;
      // L'état gardé survit à une liste reposée à l'identique : sans quoi chaque annonce en
      // provoquerait une autre et la scène ne se tairait jamais. Une liste d'une autre taille le
      // retire, et la première comparaison qui suit annonce un changement, ce qui est exact.
      if (held.length !== need) {
        held = new Float64Array(need);
        posed = false;
      }
    },
    /** Dit si l'hôte a écrit un des nœuds relus depuis la lecture précédente. Ne remonte rien. */
    changed() {
      const h = held;
      let moved = !posed,
        at = 0;
      posed = true;
      for (let i = 0; i < watched.length; i++) {
        const node = watched[i],
          auto = node.matrixAutoUpdate,
          visible = node.visible ? 1 : 0,
          flag = auto ? 1 : 0;
        if (h[at] !== visible) {
          h[at] = visible;
          moved = true;
        }
        if (h[at + 1] !== flag) {
          h[at + 1] = flag;
          moved = true;
        }
        at += 2;
        if (auto) {
          // Le nœud recompose sa matrice à partir de ces dix valeurs : ce sont elles que l'hôte écrit.
          const { position: p, quaternion: q, scale: s } = node;
          poseScratch[0] = p.x;
          poseScratch[1] = p.y;
          poseScratch[2] = p.z;
          poseScratch[3] = q.x;
          poseScratch[4] = q.y;
          poseScratch[5] = q.z;
          poseScratch[6] = q.w;
          poseScratch[7] = s.x;
          poseScratch[8] = s.y;
          poseScratch[9] = s.z;
          for (let k = 0; k < 10; k++)
            if (h[at + k] !== poseScratch[k]) {
              h[at + k] = poseScratch[k];
              moved = true;
            }
          // Les six dernières places appartiennent à la matrice posée : ce nœud ne la lit pas, et
          // le drapeau qui le dirait a déjà annoncé le changement le jour où il basculerait.
        } else {
          const e = node.matrix.elements;
          for (let k = 0; k < 16; k++)
            if (h[at + k] !== e[k]) {
              h[at + k] = e[k];
              moved = true;
            }
        }
        at += NODE_SLOTS - 2;
      }
      for (let i = 0; i < lights.length; i++) {
        if (readLightInto(lights[i], h, at)) moved = true;
        at += LIGHT_SLOTS;
      }
      return moved;
    },
  };
}
