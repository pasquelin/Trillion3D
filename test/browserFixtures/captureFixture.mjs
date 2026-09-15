/** La bande d'erreur d'écran que chaque cluster d'un cache DAG porte, tirée de sa propre boîte :
 *  sans elle le moteur refuse la primitive par son nom (`STALE_CACHE`) au lieu de la lire à moitié. */
function clusterSphere({ min, max }) {
  const center = [0, 1, 2].map((i) => (min[i] + max[i]) / 2);
  return [...center, Math.hypot(...[0, 1, 2].map((i) => max[i] - center[i])) || 1];
}

/** L'erreur du cluster grossier : assez grande pour que la coupe veuille toujours le détail, si
 *  bien que seule la résidence décide entre les deux feuilles et leur remplaçant. */
const COARSE_ERROR = 1e6;

export async function captureFixture({ THREE, factory, device, events }) {
  const geometry = new THREE.PlaneGeometry(2, 2),
    material = new THREE.MeshBasicMaterial({ color: 0xff0000 });
  const mesh = new THREE.Mesh(geometry, material),
    source = new THREE.Group();
  source.add(mesh);
  source.updateMatrixWorld(true);
  const canvas = document.createElement('canvas');
  document.body.append(canvas);
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 100);
  camera.position.z = 3;
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const box = { min: [-1, -1, 0], max: [1, 1, 0] };
  const pageInfo = {
    id: 0,
    url: '0',
    count: 6,
    ...box,
    bytes: 24,
    sha256: 'fixture',
    level: 0,
    lodError: 0,
    sphere: clusterSphere(box),
    parentError: null,
    parentSphere: null,
    group: null,
    source: null,
  };
  const backend = factory({
    source,
    metadata: {
      primitives: [{ mesh: 0, primitive: 0, pass: 'exact-clusters', pages: [pageInfo] }],
    },
    indices: new Map([['0', new Uint32Array(geometry.index.array)]]),
    associations: new Map([[mesh, { meshes: 0, primitives: 0 }]]),
    gpuDevice: device,
    gpuCanvas: canvas,
    maxResidentPages: 1,
    viewport: [64, 64],
    onDiagnostic: (event) => events.push({ stage: 'fixture', ...event }),
  });
  let overlaps = 0;
  const createBuffer = device.createBuffer.bind(device);
  device.createBuffer = (descriptor) => {
    const buffer = createBuffer(descriptor);
    if (descriptor.label === 'WG explicit capture') {
      const map = buffer.mapAsync.bind(buffer);
      buffer.mapAsync = async (...args) => {
        await map(...args);
        overlaps++;
        backend.syncResident();
      };
    }
    return buffer;
  };
  try {
    await backend.prepare();
    for (let frame = 0; frame < 4; frame++) {
      backend.render(camera);
      await backend.flush();
    }
    const pixels = backend.capture();
    if (!overlaps || !events.some((event) => event.phase === 'capture-streaming-deferred'))
      throw Error('Streaming/readback overlap not exercised');
    if (pixels.length !== 64 * 64 * 4 || !pixels.some((v, i) => i % 4 === 0 && v > 100))
      throw Error('Invalid GPU fixture capture');
    // Same complete plane, split into two streamed detail pages and one pinned fallback.
    const arrays = new Map([
      ['fine0', new Uint32Array(geometry.index.array.slice(0, 3))],
      ['fine1', new Uint32Array(geometry.index.array.slice(3))],
      ['coarse', new Uint32Array(geometry.index.array)],
    ]);
    // Deux feuilles et le cluster qui les remplace : le plus petit DAG à deux niveaux légal.
    const leaf = { parentError: COARSE_ERROR, parentSphere: pageInfo.sphere, group: 0 };
    const pages = [
      { ...pageInfo, ...leaf, id: 0, url: 'fine0', count: 3, bytes: 12 },
      { ...pageInfo, ...leaf, id: 1, url: 'fine1', count: 3, bytes: 12 },
      {
        ...pageInfo,
        id: 2,
        url: 'coarse',
        role: 'coarse',
        level: 1,
        lodError: COARSE_ERROR,
        source: 0,
      },
    ];
    const structure = {
      version: 1,
      roots: [2],
      groups: [
        {
          level: 1,
          error: COARSE_ERROR,
          sphere: pageInfo.sphere,
          children: [0, 1],
          outputs: [2],
        },
      ],
    };
    const metadata = {
      primitives: [{ mesh: 0, primitive: 0, pass: 'exact-clusters', pages, structure }],
    };
    const coverage = [];
    for (const slots of [3, 2]) {
      const surface = document.createElement('canvas');
      document.body.append(surface);
      const streamed = factory({
        source,
        metadata,
        indices: new Map(),
        readPage: async (url) => arrays.get(url),
        associations: new Map([[mesh, { meshes: 0, primitives: 0 }]]),
        gpuDevice: device,
        gpuCanvas: surface,
        maxResidentPages: slots,
        viewport: [64, 64],
        onDiagnostic: (event) => events.push({ stage: 'coverage-fixture', ...event }),
      });
      try {
        await streamed.prepare();
        streamed.render(camera);
        await streamed.flush();
        const expected = streamed.capture().slice();
        for (const urls of [['fine0'], ['fine1']]) {
          for (const url of urls) streamed.acceptPage(url, arrays.get(url));
          streamed.syncResident();
          await streamed.flush();
          streamed.render(camera);
          await streamed.flush();
          const observed = streamed.capture();
          let differences = 0;
          for (let i = 0; i < expected.length; i++) if (expected[i] !== observed[i]) differences++;
          if (differences)
            throw Error('GPU coverage changed with partial residency: ' + differences);
          const ids = streamed.selectedPageIds().sort();
          const wanted = slots === 3 && urls[0] === 'fine1' ? ['fine0', 'fine1'] : ['coarse'];
          if (JSON.stringify(ids) !== JSON.stringify(wanted))
            throw Error('Unexpected GPU coverage cut: ' + JSON.stringify(ids));
          coverage.push({
            slots,
            arrived: urls,
            ids,
            differences,
            metrics: streamed.metrics(),
          });
        }
      } finally {
        streamed.dispose();
        surface.remove();
      }
    }
    events.push({
      stage: 'coverage-fixture',
      phase: 'coverage-proof',
      context: { version: 1, checks: coverage },
    });
    await device.queue.onSubmittedWorkDone();
  } finally {
    backend.dispose();
    device.destroy();
    geometry.dispose();
    material.dispose();
    canvas.remove();
  }
  await window.captureProgress('Real GPU capture overlap passed');

  return overlaps;
}
