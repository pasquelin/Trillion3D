import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { drawBlendPass } from './webgpuBlendDraw.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

const FRONT = 'front' as unknown as GPURenderPipeline,
  BACK = 'back' as unknown as GPURenderPipeline,
  TEXTURED = 'textured' as unknown as GPURenderPipeline;

/** Un item de mélange déjà lié : seul l'enchaînement des pipelines est observé ici. */
const item = (side: THREE.Side, negatif = false) => {
  const matrix = new THREE.Matrix4();
  if (negatif) matrix.makeScale(-1, 1, 1);
  return {
    material: new THREE.MeshBasicMaterial({ side }),
    matrix,
    count: 3,
    group: {} as GPUBindGroup,
    paged: false,
  };
};

function joue(items: ReturnType<typeof item>[]) {
  const pipelines: unknown[] = [];
  const draws: number[] = [];
  const pass = {
    setViewport() {},
    setBindGroup() {},
    setPipeline(pipeline: unknown) {
      pipelines.push(pipeline);
    },
    draw(count: number) {
      draws.push(count);
    },
    drawIndirect() {},
    end() {},
  };
  const rt = {
    vis: {
      visEnabled: true,
      pipelineBlendFront: FRONT,
      pipelineBlendBack: BACK,
      pipelineBlendTextured: TEXTURED,
    },
    gpu: { hdrView: {}, colorView: {}, depthView: {}, targetSize: [8, 8] },
    blendState: { visibleBlend: items, compaction: undefined },
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
    {} as GPUDevice,
    { beginRenderPass: () => pass } as unknown as GPUCommandEncoder,
    0,
    true,
  );
  return { pipelines, draws, calls: rt.run.blendDrawCalls };
}

test('la passe de mélange ne pose un pipeline que lorsqu’il change', () => {
  // Trois items d'affilée qui demandent la même face : un seul pipeline posé, trois dessins.
  const suite = joue([
    item(THREE.FrontSide),
    item(THREE.FrontSide),
    item(THREE.FrontSide),
    item(THREE.BackSide),
    item(THREE.BackSide),
  ]);
  assert.equal(suite.calls, 5, 'chaque item est dessiné, comme avant');
  assert.deepEqual(suite.draws, [3, 3, 3, 3, 3]);
  assert.deepEqual(suite.pipelines, [BACK, FRONT], 'un pipeline par changement, dans l’ordre');
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
