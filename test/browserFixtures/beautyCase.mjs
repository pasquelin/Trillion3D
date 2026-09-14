export async function runCase(options, { THREE, webgpuPagesBackend, device, camera, size, read }) {
  const { name, externalOrm, occlusion, minified, normalTest, ...params } = options,
    geometry = new THREE.PlaneGeometry(2, 2);
  let externalTexture;
  if (externalOrm) {
    const c = document.createElement('canvas');
    c.width = c.height = 2;
    const ctx = c.getContext('2d');
    ctx.fillStyle = 'rgb(255,255,0)';
    ctx.fillRect(0, 0, 2, 2);
    externalTexture = new THREE.Texture(await createImageBitmap(c));
    externalTexture.needsUpdate = true;
    params.metalnessMap = externalTexture;
    params.roughnessMap = externalTexture;
  }
  if (occlusion) {
    const ao = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    ao.needsUpdate = true;
    params.aoMap = ao;
    params.aoMapIntensity = 0.8;
    externalTexture = ao;
  }
  if (minified) {
    const texels = new Uint8Array(128 * 128 * 4);
    for (let y = 0; y < 128; y++)
      for (let x = 0; x < 128; x++) {
        const o = (y * 128 + x) * 4;
        texels[o] = texels[o + 1] = texels[o + 2] = ((x + y) % 2) * 255;
        texels[o + 3] = 255;
      }
    const t = new THREE.DataTexture(texels, 128, 128);
    t.colorSpace = THREE.SRGBColorSpace;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.needsUpdate = true;
    params.map = t;
    externalTexture = t;
    const uv = geometry.attributes.uv;
    for (let i = 0; i < uv.count; i++)
      uv.setXY(i, uv.getX(i) * 64 + 0.123, uv.getY(i) * 64 + 0.123);
  }
  if (normalTest) {
    const t = new THREE.DataTexture(new Uint8Array([160, 210, 230, 255]), 1, 1);
    t.needsUpdate = true;
    params.normalMap = t;
    externalTexture = t;
    if (normalTest === 'tangent') {
      geometry.setAttribute(
        'tangent',
        new THREE.Float32BufferAttribute(Array.from({ length: 4 }, () => [0, 1, 0, -1]).flat(), 4),
      );
    }
    if (normalTest === 'grazing') geometry.rotateY(1.4);
    if (normalTest === 'clipped') geometry.scale(10, 10, 1).rotateY(1.4);
    if (normalTest === 'back') {
      geometry.rotateY(Math.PI);
      params.side = THREE.DoubleSide;
    }
    if (normalTest === 'scale') params.normalScale = new THREE.Vector2(1, -0.5);
    if (normalTest === 'mirror') {
      const uv = geometry.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setX(i, -uv.getX(i));
    }
  }
  const material = new THREE.MeshStandardMaterial(params),
    mesh = new THREE.Mesh(geometry, material),
    source = new THREE.Group();
  source.add(mesh);
  source.updateMatrixWorld(true);
  const reference = new THREE.Scene();
  reference.background = new THREE.Color(0x2a303c);
  reference.add(mesh.clone());
  reference.add(new THREE.HemisphereLight(0xffffff, 0x495061, 2));
  const l = new THREE.DirectionalLight(0xffffff, 2.5);
  l.position.set(1, 3, 2);
  reference.add(l);
  geometry.computeBoundingBox();
  const min = geometry.boundingBox.min.toArray(),
    max = geometry.boundingBox.max.toArray();
  const indices = new Map([['0', new Uint32Array(geometry.index.array)]]),
    metadata = {
      primitives: [
        {
          mesh: 0,
          primitive: 0,
          pass: params.transparent ? 'shared-blend' : 'exact-clusters',
          pages: [{ id: 0, url: '0', count: 6, min, max, bytes: 24, sha256: 'x' }],
        },
      ],
    };
  const events = [];
  const backend = webgpuPagesBackend({
    source,
    metadata,
    indices,
    associations: new Map([[mesh, { meshes: 0, primitives: 0 }]]),
    maxResidentPages: 1,
    viewport: [size, size],
    gpuDevice: device,
    clearColor: 0x2a303c,
    onDiagnostic: (event) => events.push(event),
  });
  await backend.prepare();
  for (let i = 0; i < 4; i++) {
    backend.render(camera);
    await backend.flush();
  }
  const raw = Array.from(backend.capture().slice((32 * size + 32) * 4, (32 * size + 32) * 4 + 4));
  const referencePixels = read(reference),
    webgpuPixels = read(backend.scene);
  const pixel = (pixels, x, y) =>
    Array.from(pixels.slice((y * size + x) * 4, (y * size + x) * 4 + 4));
  const samples = [20, 32, 44].flatMap((y) =>
    [20, 32, 44].map((x) => ({
      x,
      y,
      reference: pixel(referencePixels, x, y),
      webgpu: pixel(webgpuPixels, x, y),
    })),
  );
  const result = {
    name,
    events,
    samples,
    reference: pixel(referencePixels, 32, 32),
    webgpu: pixel(webgpuPixels, 32, 32),
    raw,
    capabilities: JSON.parse(JSON.stringify(backend.capabilities)),
  };
  backend.dispose();
  geometry.dispose();
  material.dispose();
  externalTexture?.dispose();
  return result;
}
