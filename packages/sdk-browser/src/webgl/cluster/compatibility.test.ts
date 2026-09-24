import assert from 'node:assert/strict';
import test from 'node:test';
import * as G from '../../host/graph/graph.fixture.ts';
import { clusterMaterialReason } from './compatibility.ts';
import { validateClusterMeshes } from './validation.ts';
import { drawPasses } from '../../cluster/batchMesh.ts';

const position = new G.GraphAttribute(new Float32Array(9), 3);
const NO_COPIES = { plain: [], blended: [], transmissive: [] };
// A stand-in image: these tests never rasterize a texture, only its presence is read
// (`!texture.image`), so a placeholder typed as the DOM's texture-source union is enough.
const FAKE_IMAGE = {} as TexImageSource;
const fakeTexture = () => new G.GraphTexture(FAKE_IMAGE);

test('an untextured Basic material needs no unused UV or normal attribute', () => {
  assert.equal(clusterMaterialReason(G.basicSurface(), { position }), undefined);
});

test('a Depth material draws on the autonomous path; another unlit family is still refused', () => {
  assert.equal(clusterMaterialReason(new G.GraphSurface('depth'), { position }), undefined);
  assert.match(
    clusterMaterialReason(new G.GraphSurface('normal'), { position })!,
    /normal is unsupported/,
  );
});

test('unsupported mutations refuse the autonomous draw before it becomes partial', () => {
  const material = G.standardSurface();
  assert.equal(
    clusterMaterialReason(material, { position }),
    'lit material has no normal attribute',
  );
  material.transparent = true;
  assert.equal(
    clusterMaterialReason(material, {
      position,
      normal: new G.GraphAttribute(new Float32Array(9), 3),
    }),
    undefined,
  );
  material.premultipliedAlpha = true;
  assert.match(clusterMaterialReason(material, { position })!, /unsupported blend state/);
  material.premultipliedAlpha = false;
  material.transparent = false;
  material.wireframe = true;
  assert.match(clusterMaterialReason(material, { position })!, /unsupported extension/);
  material.wireframe = false;
  material.alphaMap = fakeTexture();
  assert.match(clusterMaterialReason(material, { position })!, /unsupported extension/);
});

test('a normal-mapped material needs no tangent attribute: the shader rebuilds the frame', () => {
  const material = G.standardSurface({ normalMap: fakeTexture() });
  assert.equal(
    clusterMaterialReason(material, {
      position,
      normal: new G.GraphAttribute(new Float32Array(9), 3),
      uv: new G.GraphAttribute(new Float32Array(6), 2),
    }),
    undefined,
  );
});

test('a texture selecting UV1 is refused when geometry has only UV0', () => {
  const material = G.basicSurface({ map: fakeTexture() });
  (material.map as G.GraphTexture).channel = 1;
  assert.match(
    clusterMaterialReason(material, {
      position,
      uv: new G.GraphAttribute(new Float32Array(6), 2),
    })!,
    /no UV1 attribute/,
  );
});

test('one material is validated against every distinct geometry attribute set', () => {
  const material = G.basicSurface({ map: fakeTexture() });
  (material.map as G.GraphTexture).channel = 1;
  const uv = new G.GraphAttribute(new Float32Array(6), 2);
  assert.throws(
    () =>
      validateClusterMeshes(
        [
          { material, geometry: { attributes: { position, uv, uv1: uv } } },
          { material, geometry: { attributes: { position, uv } } },
        ] as never,
        [],
        NO_COPIES,
        new Map(),
      ),
    /no UV1 attribute/,
  );
});

test('a runtime mutation to a material array is rejected instead of disappearing', () => {
  const material = G.basicSurface();
  assert.throws(
    () =>
      validateClusterMeshes(
        [{ material: [material], geometry: { attributes: { position } } }] as never,
        [],
        NO_COPIES,
        new Map(),
      ),
    /material arrays are unsupported/,
  );
});

test('a mutation of a two-sided transparent material is read at the draw, never frozen', () => {
  const source = G.basicSurface({ transparent: true, side: G.DOUBLE_SIDE });
  const mesh = { material: source, geometry: { attributes: { position } } } as never;
  assert.deepEqual(drawPasses(source), ['back', 'front']);
  validateClusterMeshes([mesh], [], NO_COPIES, new Map());
  source.forceSinglePass = true;
  assert.deepEqual(drawPasses(source), [undefined], 'one pass on the declared faces');
  source.premultipliedAlpha = true;
  assert.throws(
    () => validateClusterMeshes([mesh], [], NO_COPIES, new Map()),
    /unsupported blend state/,
  );
});

test('a transmissive physical material is a scene copy of the transmission pass, never a cluster', () => {
  const normal = new G.GraphAttribute(new Float32Array(9), 3);
  const glass = G.physicalSurface({ transmission: 1, ior: 1.5, thickness: 0.1 });
  assert.match(clusterMaterialReason(glass, { position, normal })!, /drawn as a scene copy/);
  assert.equal(clusterMaterialReason(glass, { position, normal }, true), undefined);
  const plain = G.physicalSurface();
  assert.equal(clusterMaterialReason(plain, { position, normal }), undefined);
  assert.equal(clusterMaterialReason(plain, { position, normal }, true), undefined);
  plain.ior = 1.3;
  assert.match(clusterMaterialReason(plain, { position, normal })!, /ior without transmission/);
  glass.ior = 1.3;
  assert.equal(clusterMaterialReason(glass, { position, normal }, true), undefined);
  glass.clearcoat = 0.5;
  assert.match(clusterMaterialReason(glass, { position, normal }, true)!, /clearcoat/);
  glass.clearcoat = 0;
  glass.thicknessMap = fakeTexture();
  assert.match(clusterMaterialReason(glass, { position, normal }, true)!, /thicknessMap/);
});

test('a transmissive copy mutated into another physical extension is refused before drawing', () => {
  const normal = new G.GraphAttribute(new Float32Array(9), 3);
  const glass = G.physicalSurface({ transmission: 1 });
  const copy = { material: glass, geometry: { attributes: { position, normal } } } as never;
  const copies = { ...NO_COPIES, transmissive: [copy] };
  validateClusterMeshes([], [], copies, new Map());
  glass.sheen = 1;
  assert.throws(() => validateClusterMeshes([], [], copies, new Map()), /sheen/);
  glass.sheen = 0;
  // A blended copy the owner submits is validated like a page: it never transmits.
  assert.throws(
    () => validateClusterMeshes([], [], { ...NO_COPIES, blended: [copy] }, new Map()),
    /drawn as a scene copy/,
  );
});

// The gate no longer compares against the host library's own class to find a shader hook: it
// asks whether the material reaches a compile hook other than the one it inherits.
test('a compile hook the host installed is refused, the empty one it inherits is not', () => {
  const normal = new G.GraphAttribute(new Float32Array(9), 3);
  const material = G.standardSurface();
  assert.equal(clusterMaterialReason(material, { position, normal }), undefined);
  material.onBeforeCompile = () => {};
  assert.match(clusterMaterialReason(material, { position, normal })!, /carries a shader hook/);
});
