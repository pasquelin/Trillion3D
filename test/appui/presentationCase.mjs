import { createScene } from './presentationScene.mjs';
import { createFrame } from './presentationFrame.mjs';

export async function runCase(fixture, context) {
  const {
    THREE,
    webgpuPagesBackend,
    device,
    events,
    passes,
    capture,
    check,
    equal,
    checkNormalPasses,
    checks,
  } = context;
  const { backend, canvas, viewport, camera, geometries, materials, textures } = createScene(
    fixture,
    { THREE, webgpuPagesBackend, device, events },
  );
  try {
    await backend.prepare();
    backend.render(camera);
    await backend.flush();
    const outputCanvas = canvas ?? backend.presentedSurface;
    check(outputCanvas instanceof HTMLCanvasElement, fixture.name + ': no output canvas');
    const frame = createFrame({
      backend,
      camera,
      passes,
      checkNormalPasses,
      capture,
      outputCanvas,
      check,
      equal,
      viewport,
    });
    await frame(fixture.name, { synchronous: true });
    if (fixture.kind === 'blend')
      check(
        passes.some((pass) => pass.name === 'WG transparents'),
        fixture.name + ': transparent pass was not exercised',
      );
    if (fixture.kind !== 'blend') {
      for (const mode of ['wireframe', 'clusters', 'pages']) {
        backend.setDiagnostic(mode);
        await frame(fixture.name + ' ' + mode);
      }
      backend.setDiagnostic('beauty');
    }
    viewport[0] = 73;
    viewport[1] = 45;
    camera.aspect = viewport[0] / viewport[1];
    camera.updateProjectionMatrix();
    const beforeSurface = await frame(fixture.name + ' resized');
    const other = camera.clone();
    other.position.x = 0.8;
    other.lookAt(0, 0, 0);
    other.updateMatrixWorld();
    const surfaceStart = passes.length;
    const surface = await backend.captureSurfaceView(other, { width: 35, height: 27 });
    try {
      check(
        surface.width === 35 && surface.height === 27,
        fixture.name + ': surface capture dimensions',
      );
      check(surface.cameraWorld[0] === 0.8, fixture.name + ': surface camera was ignored');
      const surfacePasses = passes.slice(surfaceStart);
      check(
        !surfacePasses.some(
          (pass) => pass.name.startsWith('WG HDR composition') && pass.colorAttachments === 2,
        ),
        fixture.name + ': secondary capture touched the visible canvas',
      );
      check(
        surfacePasses.filter((pass) => pass.name === 'WG direct present').length === 1,
        fixture.name + ': main canvas was not restored once',
      );
      const restored = capture.read(outputCanvas);
      equal(restored, beforeSurface, fixture.name + ' secondary restore canvas');
      await backend.flush();
      equal(backend.capture(), beforeSurface, fixture.name + ' secondary restore GPU target');
      check(
        viewport[0] === 73 &&
          viewport[1] === 45 &&
          outputCanvas.width === 73 &&
          outputCanvas.height === 45,
        fixture.name + ': secondary dimensions leaked into main view',
      );
      checks.push({ name: fixture.name + ' secondary camera', passes: surfacePasses });
    } finally {
      surface.dispose();
    }
    camera.position.set(100, 0, 3);
    camera.lookAt(100, 0, 0);
    camera.updateMatrixWorld();
    await frame(fixture.name + ' empty', { empty: true });
    check(
      !backend.capabilities.unsupported.includes('visibility buffer'),
      fixture.name + ': visibility fallback occurred',
    );
  } finally {
    backend.dispose();
    canvas?.remove();
    geometries.forEach((value) => value.dispose());
    materials.forEach((value) => value.dispose());
    textures.forEach((value) => value.dispose());
  }
}
