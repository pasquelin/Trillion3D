// Une transformation ne dessine pas. Elle marque la scène modifiée ; le rendu suivant la prend.
// Avant ce lot, `setTransform` appelait `syncResident()` sur chaque moteur, et celui-ci rendait
// tout de suite : dix poses posées avant une image coûtaient onze soumissions de carte graphique
// au lieu d'une. Le compteur de ce test est celui d'un appareil simulé — `queue.submit`.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createExplorerLightApi } from './explorerLightApi.ts';
import { createFrameGateCore } from './frameGateCore.ts';
import { setWebgpuTransform } from './webgpuPagesTransform.ts';
import type { RenderBackend } from './backendTypes.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

/** Un moteur simulé qui soumet à la carte graphique dès qu'on lui demande une image. */
function moteur() {
  let submissions = 0;
  const device = { queue: { submit: () => submissions++ } };
  const backend = {
    setTransform() {},
    syncResident() {
      device.queue.submit();
    },
    render() {
      device.queue.submit();
    },
  } as unknown as RenderBackend;
  return {
    backend,
    get submissions() {
      return submissions;
    },
  };
}

function api(backend: RenderBackend) {
  return createExplorerLightApi({
    check: () => {},
    store: undefined,
    imported: [],
    backends: [backend],
  });
}

const pose = (x: number, y: number) =>
  new Float32Array(new THREE.Matrix4().makeTranslation(x, y, 0).elements);

test('dix transformations puis une image : une soumission de rendu, pas onze', () => {
  const m = moteur();
  const explorer = api(m.backend);
  for (let i = 0; i < 10; i++) explorer.setTransform(`n${i}`, pose(i, 0));
  assert.equal(m.submissions, 0, 'aucune image soumise pendant les poses');
  m.backend.render!(new THREE.PerspectiveCamera());
  assert.equal(m.submissions, 1, 'le rendu explicite de l’hôte soumet une fois, et une seule');
});

test('un moteur qui ne sait pas déplacer un nœud refuse par une erreur nommée', () => {
  const explorer = api({} as RenderBackend);
  assert.throws(
    () => explorer.setTransform('n0', pose(0, 0)),
    /aucun moteur de cette session ne déplace un nœud nommé/,
  );
});

/** Le strict minimum que `setWebgpuTransform` lit : une scène, une porte d'image, un ordonnanceur. */
function banc() {
  const source = new THREE.Object3D();
  const node = new THREE.Object3D();
  node.name = 'volet';
  source.add(node);
  source.updateMatrixWorld(true);
  const gate = createFrameGateCore(1);
  const rows = { tableEpoch: 0 };
  const rt = {
    setup: { source },
    layout: { selectionRoots: [], rows },
    run: { gate, temporalHizState: {}, noOccluderHistory: false },
    lights: { plan: { worldChanged: () => {} } },
  } as unknown as WebgpuPagesRuntime;
  const camera = new THREE.PerspectiveCamera();
  const drawn = [{ sourceMesh: node }];
  /** Une image de la boucle : la porte décide de tenir, puis range ce qu'elle vient de produire. */
  const frame = () => {
    const held = gate.enterFrame({}, camera, {}, undefined, source, drawn);
    gate.hold.keep(gate.revisions);
    return held;
  };
  return { rt, node, rows, frame };
}

/** Ce que l'image dessinerait de ce nœud : sa matrice monde, telle que le moteur la lirait. */
const image = (node: THREE.Object3D) => node.matrixWorld.elements.join(',');

test('une pose change l’image tenue : la porte refuse de resservir la précédente', () => {
  const b = banc();
  b.frame();
  b.frame();
  assert.equal(b.frame(), true, 'rien n’a bougé : l’image est tenue');
  const avant = image(b.node);
  setWebgpuTransform(b.rt, 'volet', pose(0, 1));
  assert.equal(b.frame(), false, 'la pose posée, l’image tenue est refusée');
  assert.notEqual(image(b.node), avant, 'et le nœud dessiné porte bien la nouvelle pose');
});

test('la même pose reposée ne périme rien : l’image reste tenue', () => {
  const b = banc();
  setWebgpuTransform(b.rt, 'volet', pose(0, 1));
  b.frame();
  b.frame();
  assert.equal(b.frame(), true, 'l’image est tenue');
  const epoque = b.rows.tableEpoch;
  for (let i = 0; i < 10; i++) setWebgpuTransform(b.rt, 'volet', pose(0, 1));
  assert.equal(b.rows.tableEpoch, epoque, 'dix poses identiques, aucune table refaite');
  assert.equal(b.frame(), true, 'et l’image tenue le reste');
});
