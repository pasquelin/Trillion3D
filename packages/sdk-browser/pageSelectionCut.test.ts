import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  collectClusterPages,
  selectVisiblePages,
  type PageRec,
} from './pageSelection.ts';
import { wideCamera } from './pageSelectionDagFixture.ts';
import { dagCulling } from './pageSelectionTestHelpers.ts';

/**
 * Small 3-level hierarchy fixture for testing hierarchical cut.
 * Levels: root -> mid (2 nodes) -> leaf (4 nodes)
 */
function hierarchicalFixture() {
  const positions: number[] = [];
  for (let t = 0; t < 4; t++) {
    const x = -2 + t;
    positions.push(x, -0.5, 0, x + 1, -0.5, 0, x + 0.5, 0.5, 0);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex([...Array(12).keys()]);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  const source = new THREE.Group();
  source.add(mesh);

  const leftSphere = [-1, 0, 0, 1.2],
    rightSphere = [1, 0, 0, 1.2],
    rootSphere = [0, 0, 0, 2.3];
  const midError = 0.02,
    rootError = 0.2;

  const leaf = (id: number) => ({
    id,
    url: `leaf${id}`,
    sha256: `leaf${id}`,
    bytes: 12,
    count: 3,
    min: [-2 + id, -0.5, 0],
    max: [-1 + id, 0.5, 0],
    role: 'exact' as const,
    level: 0,
    lodError: 0,
    sphere: [-1.5 + id, 0, 0, 0.6],
    parentError: midError,
    parentSphere: id < 2 ? leftSphere : rightSphere,
    group: id < 2 ? 0 : 1,
    source: null,
  });

  const pages = [
    leaf(0),
    leaf(1),
    leaf(2),
    leaf(3),
    {
      id: 4,
      url: 'mid-left',
      sha256: 'mid-left',
      bytes: 12,
      count: 3,
      min: [-2, -0.5, 0],
      max: [0, 0.5, 0],
      role: 'coarse' as const,
      level: 1,
      lodError: midError,
      sphere: leftSphere,
      parentError: rootError,
      parentSphere: rootSphere,
      group: 2,
      source: 0,
    },
    {
      id: 5,
      url: 'mid-right',
      sha256: 'mid-right',
      bytes: 12,
      count: 3,
      min: [0, -0.5, 0],
      max: [2, 0.5, 0],
      role: 'coarse' as const,
      level: 1,
      lodError: midError,
      sphere: rightSphere,
      parentError: rootError,
      parentSphere: rootSphere,
      group: 2,
      source: 1,
    },
    {
      id: 6,
      url: 'root',
      sha256: 'root',
      bytes: 12,
      count: 3,
      min: [-2, -0.5, 0],
      max: [2, 0.5, 0],
      role: 'coarse' as const,
      level: 2,
      lodError: rootError,
      sphere: rootSphere,
      parentError: null,
      parentSphere: null,
      group: null,
      source: 2,
    },
  ];

  const structure = {
    version: 1,
    roots: [6],
    groups: [
      { level: 1, error: midError, sphere: leftSphere, children: [0, 1], outputs: [4] },
      { level: 1, error: midError, sphere: rightSphere, children: [2, 3], outputs: [5] },
      { level: 2, error: rootError, sphere: rootSphere, children: [4, 5], outputs: [6] },
    ],
  };

  const metadata = {
    errorModel: 'dag-group-qem-v1',
    clusterStrategy: 'dag-groups',
    primitives: [
      {
        mesh: 0,
        primitive: 0,
        pass: 'exact-clusters',
        clusterStrategy: 'dag-groups' as const,
        pages,
        hierarchy: null,
        structure,
      },
    ],
  } as unknown as { primitives: unknown[]; errorModel: string; clusterStrategy: string };

  const indices = new Map(pages.map((page) => [page.url, new Uint32Array([0, 1, 2])]));
  for (let id = 0; id < 4; id++)
    indices.set(`leaf${id}`, new Uint32Array([id * 3, id * 3 + 1, id * 3 + 2]));

  return {
    geometry,
    mesh,
    source,
    metadata,
    indices,
    associations: new Map([[mesh, { meshes: 0, primitives: 0 }]]),
  };
}

test('hierarchical cut identical to flat selection for all-visible camera', () => {
  const flat = hierarchicalFixture(),
    hierarchical = hierarchicalFixture();
  hierarchical.metadata.primitives[0].culling = dagCulling();

  const cam = wideCamera();
  const flatResult = selectVisiblePages(
    collectClusterPages(flat.source, flat.metadata as any, flat.indices, flat.associations).roots,
    cam,
    { pixelError: 0, viewport: [1280, 720], frame: 1, holdResident: true },
  );
  const hierarchicalResult = selectVisiblePages(
    collectClusterPages(
      hierarchical.source,
      hierarchical.metadata as any,
      hierarchical.indices,
      hierarchical.associations,
    ).roots,
    cam,
    { pixelError: 0, viewport: [1280, 720], frame: 1, holdResident: true },
  );

  assert.deepEqual(
    flatResult.shown.map((p) => p.url).sort(),
    hierarchicalResult.shown.map((p) => p.url).sort(),
    'same clusters shown with hierarchical cut',
  );
  assert.deepEqual(
    flatResult.wanted.map((p) => p.url).sort(),
    hierarchicalResult.wanted.map((p) => p.url).sort(),
    'same clusters wanted with hierarchical cut',
  );
  flat.geometry.dispose();
  hierarchical.geometry.dispose();
});

test('hierarchical cut identical to flat selection for all-out-of-frustum camera', () => {
  const flat = hierarchicalFixture(),
    hierarchical = hierarchicalFixture();
  hierarchical.metadata.primitives[0].culling = dagCulling();

  const cam = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 1000);
  cam.position.set(0, 0, -100);
  cam.lookAt(0, 0, -1000);
  cam.updateMatrixWorld();

  const flatResult = selectVisiblePages(
    collectClusterPages(flat.source, flat.metadata as any, flat.indices, flat.associations).roots,
    cam,
    { pixelError: 0, viewport: [1280, 720], frame: 1, holdResident: true },
  );
  const hierarchicalResult = selectVisiblePages(
    collectClusterPages(
      hierarchical.source,
      hierarchical.metadata as any,
      hierarchical.indices,
      hierarchical.associations,
    ).roots,
    cam,
    { pixelError: 0, viewport: [1280, 720], frame: 1, holdResident: true },
  );

  assert.deepEqual(
    flatResult.shown.map((p) => p.url).sort(),
    hierarchicalResult.shown.map((p) => p.url).sort(),
    'same clusters shown with hierarchical cut (all out of frustum)',
  );
  flat.geometry.dispose();
  hierarchical.geometry.dispose();
});

test('hierarchical cut identical to flat selection for mixed camera', () => {
  const flat = hierarchicalFixture(),
    hierarchical = hierarchicalFixture();
  hierarchical.metadata.primitives[0].culling = dagCulling();

  const cam = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 1000);
  cam.position.set(1, 0, 5);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld();

  const flatResult = selectVisiblePages(
    collectClusterPages(flat.source, flat.metadata as any, flat.indices, flat.associations).roots,
    cam,
    { pixelError: 0, viewport: [1280, 720], frame: 1, holdResident: true },
  );
  const hierarchicalResult = selectVisiblePages(
    collectClusterPages(
      hierarchical.source,
      hierarchical.metadata as any,
      hierarchical.indices,
      hierarchical.associations,
    ).roots,
    cam,
    { pixelError: 0, viewport: [1280, 720], frame: 1, holdResident: true },
  );

  assert.deepEqual(
    flatResult.shown.map((p) => p.url).sort(),
    hierarchicalResult.shown.map((p) => p.url).sort(),
    'same clusters shown with hierarchical cut (mixed camera)',
  );
  flat.geometry.dispose();
  hierarchical.geometry.dispose();
});

test('node accepted in bulk has all clusters under threshold (monotonicity invariant)', () => {
  const fixture = hierarchicalFixture();
  fixture.metadata.primitives[0].culling = dagCulling();

  const { roots } = collectClusterPages(
    fixture.source,
    fixture.metadata as any,
    fixture.indices,
    fixture.associations,
  );

  const cam = wideCamera();
  const cam_viewport: [number, number] = [1280, 720];

  for (const pixelError of [0, 0.01, 0.02, 0.1, 0.2, 1]) {
    const result = selectVisiblePages(roots, cam, {
      pixelError,
      viewport: cam_viewport,
      frame: 1,
      holdResident: true,
    });

    for (const cluster of result.shown) {
      if (cluster.lodError !== undefined) {
        assert.ok(
          cluster.lodError <= pixelError,
          `cluster ${cluster.url} with error ${cluster.lodError} accepted but exceeds pixelError ${pixelError}`,
        );
      }
    }
  }

  fixture.geometry.dispose();
});

test('node with invalid bounds (NaN/Infinity) is rejected at preparation', () => {
  const fixture = hierarchicalFixture();
  fixture.metadata.primitives[0].culling = dagCulling();

  const page = fixture.metadata.primitives[0].pages[4] as {
    parentError: number | null;
    parentSphere: number[] | null;
  };
  page.parentError = 0.1;
  page.parentSphere = [NaN, 0, 0, 1];

  assert.throws(
    () =>
      collectClusterPages(
        fixture.source,
        fixture.metadata as any,
        fixture.indices,
        fixture.associations,
      ),
    /Parametres de cluster invalides/,
    'node with invalid parentSphere must be rejected',
  );

  fixture.geometry.dispose();
});

test('nodesTested counter is integer >= 0 after image with hierarchical cut', () => {
  const fixture = hierarchicalFixture();
  fixture.metadata.primitives[0].culling = dagCulling();

  const { roots } = collectClusterPages(
    fixture.source,
    fixture.metadata as any,
    fixture.indices,
    fixture.associations,
  );

  const cam = wideCamera();

  for (const frame of [1, 2, 3]) {
    const result = selectVisiblePages(roots, cam, {
      pixelError: 0,
      viewport: [1280, 720],
      frame,
      holdResident: true,
    });

    assert.ok(
      Number.isInteger(result.nodesTested),
      `nodesTested must be an integer, got ${result.nodesTested}`,
    );
    assert.ok(
      result.nodesTested >= 0,
      `nodesTested must be >= 0, got ${result.nodesTested}`,
    );
  }

  fixture.geometry.dispose();
});

test('no allocation per frame with hierarchical cut when using same camera', () => {
  const fixture = hierarchicalFixture();
  fixture.metadata.primitives[0].culling = dagCulling();

  const { roots } = collectClusterPages(
    fixture.source,
    fixture.metadata as any,
    fixture.indices,
    fixture.associations,
  );

  const cam = wideCamera();
  const shown: PageRec[] = [];
  const wanted: PageRec[] = [];
  const result = { shown, wanted, visible: 0, selectedTriangles: 0, displayedTriangles: 0, frustumRejected: 0, nodesTested: 0, lodLevel: 0, complete: true, pixelError: 0 };
  const ask = {
    pixelError: 0,
    viewport: [1280, 720] as [number, number],
    frame: 1,
    holdResident: true,
    result,
    wanted,
  };

  const result1 = selectVisiblePages(roots, cam, ask, shown);
  const result1Ref = result1;
  const shownRef1 = result1.shown;
  const wantedRef1 = result1.wanted;

  ask.frame = 2;
  const result2 = selectVisiblePages(roots, cam, ask, shown);

  assert.equal(result2, result1Ref, 'result object is reused');
  assert.equal(result2.shown, shownRef1, 'shown array is reused');
  assert.equal(result2.wanted, wantedRef1, 'wanted array is reused');

  fixture.geometry.dispose();
});
