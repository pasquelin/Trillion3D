import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { drawBlendPass } from './webgpuBlendDraw.ts';
import { buildBlendStatics, refreshBlendPlan } from './webgpuBlendPlan.ts';
import { orderBlendPasses } from './webgpuBlendOrder.ts';
import { createWebgpuBlendState } from './webgpuBlendState.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

const FRONT = 'front' as unknown as GPURenderPipeline,
  BACK = 'back' as unknown as GPURenderPipeline,
  TEXTURED = 'textured' as unknown as GPURenderPipeline;

/** Un item de mélange déjà lié : seul l'enchaînement des pipelines est observé ici. */
const item = (side: THREE.Side, negatif = false, paged = false) => {
  const matrix = new THREE.Matrix4();
  if (negatif) matrix.makeScale(-1, 1, 1);
  return {
    material: new THREE.MeshBasicMaterial({ side }),
    matrix,
    count: 3,
    group: {} as GPUBindGroup,
    paged,
  };
};
/** Le même item, mais paginé : il lit la géométrie concaténée, donc il partage les appels. */
const pagee = (side: THREE.Side) => item(side, false, true);

function joue(items: ReturnType<typeof item>[]) {
  const pipelines: unknown[] = [];
  // Le rang de la TRANCHE dont chaque appel relit l'argument indirect : une tranche par appel, et
  // les instances de toutes ses entrées à la suite.
  const draws: number[] = [];
  const pass = {
    setViewport() {},
    setBindGroup() {},
    setPipeline(pipeline: unknown) {
      pipelines.push(pipeline);
    },
    drawIndirect(_args: GPUBuffer, offset: number) {
      draws.push(offset / 16);
    },
    end() {},
  };
  // Les groupes de liaison sont rebâtis à la première passe, quand les ressources d'éclairage
  // entrent dans la clé : le stub en donne assez pour que la construction aboutisse.
  const atlas = { classes: Array.from({ length: 16 }, () => ({ view: {} })) };
  // L'ordre des pipelines n'est plus décidé dans la boucle d'encodage : il est cuit dans le plan
  // statique, une entrée par face, bâtie avec la scène. On le bâtit donc ici comme la préparation.
  const blendState = Object.assign(createWebgpuBlendState(), {
    argsBuffer: {} as GPUBuffer,
    itemBuffer: {} as GPUBuffer,
    viewBuffer: {} as GPUBuffer,
  });
  blendState.blendGpu.push(...(items as unknown as (typeof blendState.blendGpu)[number][]));
  buildBlendStatics(blendState);
  refreshBlendPlan(blendState);
  // Le classement de l'image pose le verdict du tronc et découpe le plan en tranches : c'est lui
  // qui décide combien d'appels la passe encode. Tous les items sont au même endroit, donc l'ordre
  // source les départage.
  orderBlendPasses(blendState, [0, 0, 0]);
  const rt = {
    vis: {
      visEnabled: true,
      pipelineBlendFront: FRONT,
      pipelineBlendBack: BACK,
      pipelineBlendTextured: TEXTURED,
      blendBindGroupLayout: {},
      colorAtlas: atlas,
      dataAtlas: atlas,
      mapsSampler: {},
      materialScales: {},
      slots: { color: {}, data: {} },
    },
    gpu: {
      hdrView: {},
      colorView: {},
      depthView: {},
      targetSize: [8, 8],
      volumeBuffer: {},
      backdrop: { colorView: {}, depthView: {}, active: false },
      cache: { buffer: {} },
      uniformBuffer: {},
      zeroUv: {},
      deferred: {
        placeholders: { slices: {}, atlasView: {}, sampler: {}, bounceGrid: {}, probes: {} },
      },
    },
    lights: { buffer: {}, shadows: undefined, store: { count: 0, unlit: false } },
    bounce: { probes: undefined },
    // Vue `lit` sans lampe : le contrat éclaire, donc la passe lie ses ressources par défaut.
    sunFar: { gpu: undefined },
    blendState,
    run: {
      gpuDrawCalls: 0,
      blendDrawCalls: 0,
      blendUnpagedTriangles: 0,
      blendPagedTriangles: 0,
      blendSubmittedTriangles: 0,
    },
  } as unknown as WebgpuPagesRuntime;
  drawBlendPass(
    rt,
    { createBindGroup: () => ({}) } as unknown as GPUDevice,
    { beginRenderPass: () => pass } as unknown as GPUCommandEncoder,
  );
  return { pipelines, draws, calls: rt.run.blendDrawCalls };
}

test('un item non paginé garde son appel : il porte ses propres tampons', () => {
  // Cinq items qui ne sont pas paginés : chacun lit ses indices, ses positions et ses UV, donc
  // chacun garde son groupe de liaison et son appel — une tranche par entrée, comme avant.
  const suite = joue([
    item(THREE.FrontSide),
    item(THREE.FrontSide),
    item(THREE.FrontSide),
    item(THREE.BackSide),
    item(THREE.BackSide),
  ]);
  assert.equal(suite.calls, 5, 'un appel par item non paginé');
  assert.deepEqual(suite.draws, [0, 1, 2, 3, 4], 'chaque appel relit l’argument de SA tranche');
  assert.deepEqual(suite.pipelines, [BACK, FRONT], 'un pipeline par changement, dans l’ordre');
});

test('des items paginés qui posent le même pipeline tiennent en UN appel', () => {
  // C'est tout le lot : cinq items paginés d'affilée, un seul ordre de dessin. Ils lisent tous la
  // même géométrie concaténée et le même cache de pages, et leurs instances se suivent dans la
  // liste étalée, du plus lointain au plus proche.
  const fondu = joue([
    pagee(THREE.FrontSide),
    pagee(THREE.FrontSide),
    pagee(THREE.FrontSide),
    pagee(THREE.FrontSide),
    pagee(THREE.FrontSide),
  ]);
  assert.equal(fondu.calls, 1, 'cinq items, un appel');
  assert.deepEqual(fondu.draws, [0]);
  assert.deepEqual(fondu.pipelines, [BACK]);

  // Le pipeline reste la seule coupure : deux faces demandées, deux tranches, et pas une de plus.
  const deuxFaces = joue([pagee(THREE.FrontSide), pagee(THREE.BackSide), pagee(THREE.FrontSide)]);
  assert.equal(deuxFaces.calls, 3, 'le pipeline change deux fois, donc trois tranches');
  assert.deepEqual(deuxFaces.pipelines, [BACK, FRONT, BACK]);
});

test('un item non paginé coupe la tranche de ses voisins paginés', () => {
  // Il ne peut pas partager leur groupe de liaison : la tranche s'arrête sur lui et repart après.
  const melange = joue([
    pagee(THREE.FrontSide),
    pagee(THREE.FrontSide),
    item(THREE.FrontSide),
    pagee(THREE.FrontSide),
  ]);
  assert.equal(melange.calls, 3, 'paginés, l’isolé, paginés');
  assert.deepEqual(melange.draws, [0, 1, 2]);
  assert.deepEqual(melange.pipelines, [BACK], 'un seul pipeline pour les trois');
});

test('un item à deux faces pose bien ses deux pipelines, dans l’ordre du mélange', () => {
  const deux = joue([item(THREE.DoubleSide), item(THREE.DoubleSide)]);
  assert.equal(deux.calls, 4, 'deux dessins par item à deux faces');
  // Le second item reprend là où le premier s'est arrêté : sa première face change, la seconde aussi.
  assert.deepEqual(deux.pipelines, [FRONT, BACK, FRONT, BACK]);

  // Un déterminant négatif échange les deux faces de l'item : il commence donc par celle que le
  // précédent venait de poser, et seul ce qui change est reposé — quatre dessins, trois pipelines.
  const renverse = joue([item(THREE.DoubleSide), item(THREE.DoubleSide, true)]);
  assert.equal(renverse.calls, 4);
  assert.deepEqual(renverse.pipelines, [FRONT, BACK, FRONT]);
});
