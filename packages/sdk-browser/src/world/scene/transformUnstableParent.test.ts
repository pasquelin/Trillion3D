// Defect: the requested world pose was brought into the parent's frame by the world matrix the
// parent carried, UP TO DATE OR NOT. A host may write `parent.position.x = 10` without walking the
// graph (`updateMatrixWorld`) before posing the child — that is the contract `hostWorldChainInto`
// holds in `../../webgpu/pages/render/transform.ts`. These tests go through the explorer's PUBLIC API
// (`explorer.setTransform`, `createExplorerLightApi`), not the internal `setWebgpuTransform` called
// directly: that is what the host actually calls. The world checked is the one THE ENGINE holds
// (`../../host/world/placements.ts`), which is the one it draws.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../../host/graph/graph.fixture.ts';
import { EngineError } from '../../../../sdk-core/src/index.ts';
import { createExplorerLightApi } from '../api/lightApi.ts';
import { setWebgpuTransform } from '../../webgpu/pages/render/transform.ts';
import { createWebgpuRunState } from '../../webgpu/pages/state/run.ts';
import { hostWorldPlacements } from '../../host/world/placements.ts';
import type { RenderBackend } from '../../backend/types.ts';
import type { WebgpuPagesRuntime } from '../../webgpu/pages/runtime.ts';

function proche(obtenu: ArrayLike<number>, attendu: ArrayLike<number>, tolerance: number) {
  for (let i = 0; i < attendu.length; i++)
    assert.ok(
      Math.abs(obtenu[i] - attendu[i]) <= tolerance,
      `[${i}]: ${obtenu[i]} instead of ${attendu[i]}`,
    );
}

/** A parent/child scene, and the public explorer wired to the real `setWebgpuTransform`. */
function banc() {
  const source = new G.GraphNode();
  const parent = new G.GraphNode();
  const mesh = G.mesh();
  mesh.name = 'cible';
  parent.name = 'porteur';
  parent.add(mesh);
  source.add(parent);
  // World matrices the engine draws: it is the index, not the host scene, that the move
  // recomputes and that these tests query.
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
    active: () => backend,
  });
  return { rt, source, parent, mesh, explorer, worlds, monde };
}

const demandee = () =>
  new Float32Array(
    new G.Matrix4().compose(
      new G.Vector3(3, -2, 5),
      new G.Quaternion().setFromEuler(new G.Euler(0.4, 0.1, -0.2)),
      new G.Vector3(1.2, 0.7, 2),
    ).elements,
  );

test(
  'a parent moved, rotated and scaled by the host WITHOUT updateMatrixWorld: the child world is ' +
    'still the requested world (geometric correctness)',
  () => {
    const { parent, explorer, worlds, monde } = banc();
    // The host writes the fields directly, never calling updateMatrixWorld — exactly the gesture
    // resolution must cover: parent.matrixWorld stays the one from before this move.
    parent.position.set(10, 4, -3);
    parent.quaternion.copy(new G.Quaternion().setFromEuler(new G.Euler(0.5, -0.3, 0.2)));
    parent.scale.set(2, 3, 0.5);
    const demandeeIci = demandee();
    explorer.setTransform('cible', demandeeIci);
    proche(monde.elements, demandeeIci, 1e-9);
    // Stabilisation: the next render walks the index. The pose that was set must not move.
    worlds.refresh();
    worlds.refresh();
    proche(monde.elements, demandeeIci, 1e-9);
  },
);

test(
  'the same request remade after another parent move is not « no-op »: the world stays the ' +
    'requested world and shadow pages are invalidated (geometric correctness)',
  () => {
    const { rt, parent, explorer, worlds, monde } = banc();
    const demandeeIci = demandee();
    explorer.setTransform('cible', demandeeIci);
    worlds.refresh();
    proche(monde.elements, demandeeIci, 1e-9);
    // The revision settles: remaking the same request, before any motion, must change nothing.
    const stable = rt.run.gate.revisions.scene;
    explorer.setTransform('cible', demandeeIci);
    assert.equal(rt.run.gate.revisions.scene, stable, 'no parent motion, nothing to redo');
    // The parent moves again, without updateMatrixWorld: the frame in which the same world pose
    // is brought back has changed, so the local matrix that is set must change even if the requested
    // world is identical. The old code compared the local matrix already in memory and declared
    // « no-op » — here the revision must advance and the world stay the requested one.
    parent.position.set(20, -8, 6);
    explorer.setTransform('cible', demandeeIci);
    assert.notEqual(
      rt.run.gate.revisions.scene,
      stable,
      'the parent moved: the identical request is not a no-op',
    );
    worlds.refresh();
    proche(monde.elements, demandeeIci, 1e-9);
  },
);

test(
  'a parent flattened onto a plane (non-invertible) refuses with EngineError SINGULAR_PARENT_TRANSFORM, ' +
    'never sixteen silent zeros (geometric correctness)',
  () => {
    const { parent, explorer } = banc();
    // scale.y = 0: the parent is flattened onto the xz plane, its world matrix is no longer invertible.
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
