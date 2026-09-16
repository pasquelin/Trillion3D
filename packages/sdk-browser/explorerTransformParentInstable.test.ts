// Défaut : la pose monde demandée était ramenée dans le repère du parent par la matrice monde que
// le parent portait, À JOUR OU NON. Un hôte a le droit d'écrire `parent.position.x = 10` sans
// remonter le graphe (`updateMatrixWorld`) avant de poser l'enfant — c'est le contrat que
// `hostWorldChainInto` tient dans `webgpuPagesTransform.ts`. Ces tests passent par l'API PUBLIQUE de
// l'explorateur (`explorer.setTransform`, `createExplorerLightApi`), pas par la fonction interne
// `setWebgpuTransform` appelée directement : c'est ce que l'hôte appelle réellement. Le monde vérifié
// est celui que LE MOTEUR tient (`hostWorldPlacements.ts`), qui est celui qu'il dessine.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { EngineError } from '../sdk-core/index.ts';
import { createExplorerLightApi } from './explorerLightApi.ts';
import { setWebgpuTransform } from './webgpuPagesTransform.ts';
import { createWebgpuRunState } from './webgpuPagesStateRun.ts';
import { hostWorldPlacements } from './hostWorldPlacements.ts';
import type { RenderBackend } from './backendTypes.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

function proche(obtenu: ArrayLike<number>, attendu: ArrayLike<number>, tolerance: number) {
  for (let i = 0; i < attendu.length; i++)
    assert.ok(
      Math.abs(obtenu[i] - attendu[i]) <= tolerance,
      `[${i}] : ${obtenu[i]} au lieu de ${attendu[i]}`,
    );
}

/** Une scène parent/enfant, et l'explorateur public câblé sur le vrai `setWebgpuTransform`. */
function banc() {
  const source = new THREE.Object3D();
  const parent = new THREE.Object3D();
  const mesh = new THREE.Mesh();
  mesh.name = 'cible';
  parent.name = 'porteur';
  parent.add(mesh);
  source.add(parent);
  // Les matrices monde que le moteur dessine : c'est l'index, pas la scène de l'hôte, que le
  // déplacement recalcule et que ces tests interrogent.
  const worlds = hostWorldPlacements(source);
  const monde = worlds.of(mesh);
  const run = createWebgpuRunState();
  run.noOccluderHistory = false;
  run.temporalHizState = { pyramid: {}, camera: {} } as typeof run.temporalHizState;
  const rt = {
    setup: { source, worlds },
    layout: { selectionRoots: [], rows: { tableEpoch: 0 } },
    run,
    lights: { plan: { worldChanged: () => {} } },
  } as unknown as WebgpuPagesRuntime;
  const backend = {
    setTransform(nodeName: string, matrix: Float32Array) {
      setWebgpuTransform(rt, nodeName, matrix);
    },
  } as unknown as RenderBackend;
  const explorer = createExplorerLightApi({
    check: () => {},
    store: undefined,
    imported: [],
    backends: [backend],
  });
  return { rt, source, parent, mesh, explorer, worlds, monde };
}

const demandee = () =>
  new Float32Array(
    new THREE.Matrix4().compose(
      new THREE.Vector3(3, -2, 5),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0.4, 0.1, -0.2)),
      new THREE.Vector3(1.2, 0.7, 2),
    ).elements,
  );

test(
  'un parent déplacé, tourné et mis à l’échelle par l’hôte SANS updateMatrixWorld : le monde de ' +
    'l’enfant est quand même le monde demandé (justesse géométrique)',
  () => {
    const { parent, explorer, worlds, monde } = banc();
    // L'hôte écrit directement les champs, sans jamais rappeler updateMatrixWorld — exactement le
    // geste que la résolution doit couvrir : parent.matrixWorld reste celui d'avant ce déplacement.
    parent.position.set(10, 4, -3);
    parent.quaternion.setFromEuler(new THREE.Euler(0.5, -0.3, 0.2));
    parent.scale.set(2, 3, 0.5);
    const demandeeIci = demandee();
    explorer.setTransform('cible', demandeeIci);
    proche(monde.elements, demandeeIci, 1e-9);
    // Stabilisation : le rendu suivant remonte l'index. La pose posée ne doit pas bouger.
    worlds.refresh();
    worlds.refresh();
    proche(monde.elements, demandeeIci, 1e-9);
  },
);

test(
  'la même demande refaite après un nouveau déplacement du parent n’est pas « sans effet » : le ' +
    'monde reste le monde demandé et les pages d’ombre sont invalidées (justesse géométrique)',
  () => {
    const { rt, parent, explorer, worlds, monde } = banc();
    const demandeeIci = demandee();
    explorer.setTransform('cible', demandeeIci);
    worlds.refresh();
    proche(monde.elements, demandeeIci, 1e-9);
    // La révision se stabilise : refaire, avant tout mouvement, la même demande ne doit rien changer.
    const epoqueStable = rt.layout.rows.tableEpoch;
    (rt.run as ReturnType<typeof createWebgpuRunState>).noOccluderHistory = false;
    explorer.setTransform('cible', demandeeIci);
    assert.equal(
      rt.layout.rows.tableEpoch,
      epoqueStable,
      'sans mouvement du parent, rien à refaire',
    );
    // Le parent bouge à nouveau, sans updateMatrixWorld : le repère dans lequel la même pose monde
    // se ramène a changé, donc la matrice locale posée doit changer même si le monde demandé est
    // identique. L'ancien code comparait la matrice locale déjà en mémoire et déclarait « sans
    // effet » — ici la révision doit avancer et le monde rester celui demandé.
    parent.position.set(20, -8, 6);
    explorer.setTransform('cible', demandeeIci);
    assert.notEqual(
      rt.layout.rows.tableEpoch,
      epoqueStable,
      'le parent a bougé : la demande identique n’est pas sans effet',
    );
    assert.equal(
      (rt.run as ReturnType<typeof createWebgpuRunState>).noOccluderHistory,
      true,
      'l’historique d’occulteurs doit être jeté, pas resservi périmé',
    );
    worlds.refresh();
    proche(monde.elements, demandeeIci, 1e-9);
  },
);

test(
  'un parent écrasé sur un plan (non inversible) refuse par EngineError SINGULAR_PARENT_TRANSFORM, ' +
    'jamais seize zéros silencieux (justesse géométrique)',
  () => {
    const { parent, explorer } = banc();
    // scale.y = 0 : le parent est écrasé sur le plan xz, sa matrice monde n'est plus inversible.
    parent.scale.set(2, 0, 3);
    assert.throws(
      () => explorer.setTransform('cible', demandee()),
      (error: unknown) =>
        error instanceof EngineError &&
        error.code === 'SINGULAR_PARENT_TRANSFORM' &&
        typeof error.details.determinant === 'number' &&
        error.details.determinant === 0,
    );
  },
);
