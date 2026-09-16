import type * as THREE from 'three';
import { MATRIX_VALUES } from '../sdk-core/index.ts';
import { hostWorldChainInto } from './hostWorldChain.ts';

/** Place réservée à une lampe : couleur, intensité, portée, décroissance, cône, sol, et la position
 *  monde de sa cible quand elle en porte une. Une place fixe, comme celle d'un nœud. */
export const LIGHT_SLOTS = 14;

const finite = (value: number | undefined) => (Number.isFinite(value) ? (value as number) : 0);
const scratch = new Float64Array(LIGHT_SLOTS);
/** La matrice monde de la cible, calculée par le moteur : seule sa translation est relue. */
const targetWorld = new Float64Array(MATRIX_VALUES);

/**
 * Relit les nombres d'une lampe que les moteurs consomment, quel que soit son type, et les compare
 * à ce qui est gardé à `at`. Une propriété qu'un type ne porte pas vaut zéro : la place est la même
 * pour toutes les lampes, et la boucle appelante n'a rien à mesurer.
 *
 * La cible d'une lampe directionnelle ou conique porte sa direction et vit souvent hors du graphe
 * source : sa position monde est CALCULÉE ici, avec la lampe, et jamais par la traversée. Le moteur
 * remonte lui-même la chaîne d'ancêtres de la cible depuis leurs poses locales (`hostWorldChain.ts`)
 * au lieu de demander à l'hôte de la résoudre, et n'écrit rien dans sa scène.
 */
export function readLightInto(light: THREE.Light, held: Float64Array, at: number) {
  const shaped = light as THREE.Light & {
    distance?: number;
    decay?: number;
    angle?: number;
    penumbra?: number;
    groundColor?: THREE.Color;
    target?: THREE.Object3D;
  };
  scratch[0] = light.color.r;
  scratch[1] = light.color.g;
  scratch[2] = light.color.b;
  scratch[3] = light.intensity;
  scratch[4] = finite(shaped.distance);
  scratch[5] = finite(shaped.decay);
  scratch[6] = finite(shaped.angle);
  scratch[7] = finite(shaped.penumbra);
  const ground = shaped.groundColor;
  scratch[8] = ground ? ground.r : 0;
  scratch[9] = ground ? ground.g : 0;
  scratch[10] = ground ? ground.b : 0;
  const target = shaped.target;
  if (target) {
    hostWorldChainInto(targetWorld, target);
    scratch[11] = targetWorld[12];
    scratch[12] = targetWorld[13];
    scratch[13] = targetWorld[14];
  } else scratch[11] = scratch[12] = scratch[13] = 0;
  let moved = false;
  for (let k = 0; k < LIGHT_SLOTS; k++)
    if (held[at + k] !== scratch[k]) {
      held[at + k] = scratch[k];
      moved = true;
    }
  return moved;
}
