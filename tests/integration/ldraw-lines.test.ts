import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test, { type TestContext } from 'node:test';
import { drawnTriangles } from '../../packages/sdk-core/src/world/geometry/drawn.ts';
import { loadModel } from '../../packages/sdk-browser/src/world/core/loadedModel.ts';
import { Mesh } from '../../packages/sdk-core/src/world/object/mesh.ts';
import { Object3D } from '../../packages/sdk-core/src/world/object/object3d.ts';
import { Camera } from '../../packages/sdk-core/src/world/camera/camera.ts';
import { createWorldMembers } from '../../packages/sdk-browser/src/world/core/worldMembers.ts';
import {
  hasConditionalLine,
  updateConditionalLines,
} from '../../packages/sdk-browser/src/world/core/conditionalLines.ts';
import { machine, compiler as releaseCompiler } from './world-partition.fixture.ts';

const debugCompiler = fileURLToPath(
  new URL('../../packages/asset-compiler-rust/target/debug/trillion3d-compiler', import.meta.url),
);
const compiler = existsSync(releaseCompiler) ? releaseCompiler : debugCompiler;

async function compiledModel(t: TestContext, fixture: string) {
  const root = await mkdtemp(join(tmpdir(), 'source-lines-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = fileURLToPath(new URL(`../fixtures/formats/${fixture}`, import.meta.url));
  execFileSync(
    compiler,
    [source, root, 'full', '1000000', '1', '64', '/assets/', 'none', '--textures-format=none'],
    { stdio: 'pipe' },
  );
  const pointer = pathToFileURL(join(root, 'native/full/manifest.json'));
  machine(t, pointer);
  return loadModel(pointer.href, { textureSource: 'cache' });
}

for (const fixture of ['lines.ldr', 'mixed.mpd'])
  test(
    `native LDraw ${fixture} loads editable lines with conditional visibility and shared instances`,
    { skip: !existsSync(compiler) },
    async (t) => {
      const model = await compiledModel(t, `ldraw/${fixture}`);
      if (fixture === 'mixed.mpd') {
        let triangle: Mesh | undefined;
        model.record.scene.source.traverse((node) => {
          if (node instanceof Mesh && node.primitive === 'triangles') triangle = node;
        });
        assert.ok(triangle, 'mixed model retains its triangle drawable');
        assert.throws(() => triangle!.geometry.attributes.position.array, {
          code: 'VERTICES_NOT_LOADED',
        });
      }
      const world = new Object3D().add(model);
      const members = createWorldMembers(world);
      members.changed(world);
      members.take();
      const meshes = [...members.meshes];
      assert.equal(meshes.length, 4);
      assert.ok(meshes.every((mesh) => mesh.primitive === 'lineSegments'));
      const conditional = meshes.filter((mesh) => hasConditionalLine(mesh.geometry));
      const ordinary = meshes.filter((mesh) => !hasConditionalLine(mesh.geometry));
      assert.equal(conditional.length, 2);
      assert.equal(ordinary.length, 2);
      assert.equal(conditional[0].geometry, conditional[1].geometry);
      assert.equal(ordinary[0].geometry, ordinary[1].geometry);
      assert.notEqual(conditional[0], conditional[1]);
      for (const mesh of meshes) {
        const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
        const color = material.color as { r: number; g: number; b: number };
        assert.deepEqual([color.r, color.g, color.b], [0, 1, 0]);
      }
      const found = model.getObjectByName('linesdat');
      assert.ok(found);
      assert.equal(model.getObjectByName('linesdat'), found);
      for (const projection of ['perspective', 'orthographic'] as const) {
        const camera = new Camera(projection);
        camera.position.set(0, 0, 5);
        camera.lookAt(0, 0, 0);
        updateConditionalLines(conditional, camera);
        assert.ok(conditional.every((edge) => edge.visible));
        camera.position.set(0, 5, 0);
        camera.up.set(0, 0, 1);
        camera.lookAt(0, 0, 0);
        updateConditionalLines(conditional, camera);
        assert.ok(conditional.every((edge) => !edge.visible));
        const parent = conditional[0].parent!;
        parent.visible = false;
        camera.position.set(0, 0, 5);
        camera.up.set(0, 1, 0);
        camera.lookAt(0, 0, 0);
        updateConditionalLines(conditional, camera);
        assert.equal(conditional[0].visible, true);
        assert.equal(parent.visible, false);
        parent.visible = true;
      }
      model.position.set(1, 2, 3);
      model.updateWorldMatrix(true, true);
      const positions = ordinary.map((mesh) => mesh.matrixWorld.elements.slice(12, 15));
      assert.ok(positions.every((p) => Math.abs(p[1] - 2) < 1e-10 && Math.abs(p[2] - 3) < 1e-10));
      assert.ok(Math.abs(Math.abs(positions[0][0] - positions[1][0]) - 0.008) < 1e-10);
    },
  );

test(
  'native VRML line colours survive loading and quad expansion',
  { skip: !existsSync(compiler) },
  async (t) => {
    const model = await compiledModel(t, 'vrml/lines.wrl');
    const meshes: Mesh[] = [];
    model.traverse((node) => {
      if (node instanceof Mesh) meshes.push(node);
    });
    assert.equal(meshes.length, 1);
    const mesh = meshes[0];
    assert.equal(mesh.primitive, 'lineSegments');
    assert.equal(
      (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material).vertexColors,
      true,
    );
    const drawn = drawnTriangles(mesh.geometry, mesh.primitive)!;
    assert.equal(drawn.positions.length / 3, 12);
    assert.ok(drawn.colors, 'per-polyline colours reach the actual line quads');
    for (let vertex = 0; vertex < 12; vertex++)
      assert.deepEqual(
        Array.from(drawn.colors.slice(vertex * 4, vertex * 4 + 4)),
        vertex < 8 ? [0, 1, 0, 1] : [1, 0, 0, 1],
      );
  },
);
