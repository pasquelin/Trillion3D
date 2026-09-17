export function createScene(fixture, { THREE, webgpuPagesBackend, device, events }) {
  const texture = (bytes, width = 2, height = 2, color = false) => {
    const value = new THREE.DataTexture(new Uint8Array(bytes), width, height);
    if (color) value.colorSpace = THREE.SRGBColorSpace;
    value.needsUpdate = true;
    return value;
  };
  const source = new THREE.Group(),
    geometries = [],
    materials = [],
    textures = [],
    indices = new Map(),
    associations = new Map(),
    primitives = [];
  const colorMap = texture(
    [230, 32, 70, 255, 18, 180, 240, 0, 200, 155, 5, 255, 30, 225, 85, 255],
    2,
    2,
    true,
  );
  const normalMap = texture([140, 110, 250, 255], 1, 1);
  const ormMap = texture([145, 190, 90, 255], 1, 1);
  textures.push(colorMap, normalMap, ormMap);
  const addPlane = (material, z, transparent = false) => {
    const geometry = new THREE.PlaneGeometry(2, 2),
      mesh = new THREE.Mesh(geometry, material),
      meshIndex = primitives.length;
    mesh.position.z = z;
    source.add(mesh);
    geometries.push(geometry);
    materials.push(material);
    const min = [-1, -1, 0],
      max = [1, 1, 0],
      url = 'fixture-' + meshIndex;
    primitives.push({
      mesh: meshIndex,
      primitive: 0,
      pass: transparent ? 'shared-blend' : 'exact-clusters',
      pages: [{ id: 0, url, count: 6, min, max, bytes: 24, sha256: 'fixture' }],
    });
    indices.set(url, new Uint32Array(geometry.index.array));
    associations.set(mesh, { meshes: meshIndex, primitives: 0 });
  };
  const pbr = {
    color: 0xc5cbd8,
    roughness: 0.63,
    metalness: 0.31,
    map: colorMap,
    normalMap,
    normalScale: new THREE.Vector2(0.75, -0.4),
    roughnessMap: ormMap,
    metalnessMap: ormMap,
    aoMap: ormMap,
    aoMapIntensity: 0.8,
    emissive: 0x160903,
  };
  if (fixture.kind === 'blend')
    addPlane(new THREE.MeshStandardMaterial({ color: 0x287ba6, roughness: 0.9 }), -0.3);
  addPlane(
    fixture.kind === 'unlit'
      ? new THREE.MeshBasicMaterial({ color: 0xd9236a })
      : new THREE.MeshStandardMaterial({
          ...pbr,
          ...(fixture.kind === 'mask'
            ? { alphaTest: 0.5 }
            : fixture.kind === 'blend'
              ? { transparent: true, opacity: 0.43, side: THREE.DoubleSide }
              : {}),
        }),
    0,
    fixture.kind === 'blend',
  );
  source.updateMatrixWorld(true);
  const canvas = fixture.implicitCanvas ? undefined : document.createElement('canvas');
  if (canvas) document.body.append(canvas);
  const viewport = [64, 48],
    camera = new THREE.PerspectiveCamera(55, viewport[0] / viewport[1], 0.1, 100);
  camera.position.set(0.15, 0.1, 3);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const backend = webgpuPagesBackend({
    source,
    metadata: { primitives },
    indices,
    associations,
    gpuDevice: device,
    gpuCanvas: canvas,
    maxResidentPages: 8,
    viewport,
    clearColor: 0x2a303c,
    diagnosticDetail: 'summary',
    onDiagnostic: (event) => events.push({ fixture: fixture.name, ...event }),
  });
  return { backend, canvas, viewport, camera, geometries, materials, textures };
}
