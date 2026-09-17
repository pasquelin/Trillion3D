// Les règles que le relevé doit tenir entre deux images, et que rien ne prouvait.
//
// `gpuDagSelection2.test.ts` couvre la moitié RÉSIDENCE de la garde de relevé en vol ; la moitié
// MONDE ne l'était pas, ni le fait qu'une copie ne parte que si une relecture est due. Les deux
// deviennent des trous dès que la coupe est publiée comme autre chose qu'une liste complète : un
// relevé adopté après un changement de monde décrit une scène qui n'existe plus, et une copie
// inutile prend une fente de relecture que l'image suivante n'aura plus.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGpuDagSelection } from './gpuDagSelection.ts';
import { dagFixture, wideCamera } from './pageSelectionDagFixture.ts';
import { installGpuGlobals, mockDagDevice } from './gpuDagSelectionFixture.ts';
import { kernelUniforms, packed } from './gpuDagSelectionTestHelpers.ts';

test('un relevé en vol que traverse un changement de monde ne devient jamais la coupe tenue', async () => {
  installGpuGlobals();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const fixture = dagFixture();
  const { dag, roots } = packed(fixture);
  const uniforms = kernelUniforms(dag, roots, wideCamera(), 0);
  const selection = await createGpuDagSelection(mockDagDevice(dag, { mapGate: gate }).device, dag);
  assert.ok(selection);
  selection.dispatch(uniforms);
  // La primitive part à mille unités PENDANT que le relevé est en vol : ce qu'il rapporte décrit la
  // pose d'avant, et rien ne doit le laisser devenir la coupe de l'image.
  const moved = dag.worlds.slice();
  moved[12] = 1000;
  assert.equal(selection.updateWorlds(moved), true);
  release();
  assert.equal(await selection.flush(), null);
  assert.equal(selection.peek(), null);
  selection.dispose();
  fixture.geometry.dispose();
});

test('une copie de relevé ne part que lorsqu’une relecture est due', async () => {
  installGpuGlobals();
  const fixture = dagFixture();
  const { dag, roots } = packed(fixture);
  const uniforms = kernelUniforms(dag, roots, wideCamera(), 0);
  const { device, readbackCopies } = mockDagDevice(dag);
  const selection = await createGpuDagSelection(device, dag);
  assert.ok(selection);
  selection.dispatch(uniforms);
  await selection.flush();
  assert.equal(readbackCopies(), 1, 'la première image relit');
  // Mêmes uniformes, même résidence : le relevé tenu décrit déjà cette image. Aucun calcul, et
  // surtout aucune copie — elle prendrait une fente pour rapporter ce qui est déjà là.
  selection.dispatch(uniforms);
  selection.dispatch(uniforms);
  await selection.flush();
  assert.equal(readbackCopies(), 1, 'rien n’a changé, rien n’est recopié');
  selection.dispose();
  fixture.geometry.dispose();
});

test('une résidence republiée à l’identique ne jette pas la coupe tenue', async () => {
  installGpuGlobals();
  const fixture = dagFixture();
  const { dag, roots } = packed(fixture);
  const uniforms = kernelUniforms(dag, roots, wideCamera(), 0);
  const { device } = mockDagDevice(dag);
  const selection = await createGpuDagSelection(device, dag, { residentCut: true });
  assert.ok(selection);
  const resident = new Uint32Array(dag.pageCount).fill(1);
  assert.equal(selection.updateResidency(resident), true);
  selection.dispatch(uniforms);
  assert.ok(await selection.flush());
  assert.ok(selection.peek(), 'la coupe est tenue');
  assert.equal(selection.updateResidency(resident.slice()), false, 'aucun bit n’a bougé');
  assert.ok(selection.peek(), 'et la coupe tenue n’a pas été jetée');
  selection.dispose();
  fixture.geometry.dispose();
});
