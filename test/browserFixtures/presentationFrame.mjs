export function createFrame({
  backend,
  camera,
  passes,
  checkNormalPasses,
  capture,
  outputCanvas,
  check,
  equal,
  viewport,
}) {
  const frame = async (name, options = {}) => {
    const start = passes.length;
    backend.render(camera);
    const encoded = passes.slice(start);
    checkNormalPasses(name, encoded);
    // Read the canvas within the same task, before the swapchain can expire.
    const shown = capture.read(outputCanvas);
    await backend.flush();
    const pixels = backend.capture().slice();
    equal(shown, pixels, name + ' canvas versus GPU target');
    if (options.synchronous) {
      // A fresh render invalidates the async cache; compare its synchronous
      // capture with the preceding identical frame's independent GPU readback.
      const renderStart = passes.length;
      backend.render(camera);
      checkNormalPasses(name + ' synchronous render', passes.slice(renderStart));
      const syncStart = passes.length,
        synchronous = backend.capture().slice();
      check(
        passes.slice(syncStart).some((pass) => pass.name === 'WG direct present'),
        name + ': explicit synchronous capture must re-present the persistent target',
      );
      equal(synchronous, pixels, name + ' synchronous versus async capture');
    }
    check(
      outputCanvas.width === viewport[0] && outputCanvas.height === viewport[1],
      name + ': canvas size mismatch',
    );
    if (options.empty) {
      check(
        encoded.every((pass) => pass.name !== 'WG transparents'),
        name + ': empty transparency pass',
      );
      check(
        pixels.every((value, i) => value === [42, 48, 60, 255][i % 4]),
        name + ': clear color changed',
      );
    } else
      check(
        pixels.some((value, i) => i % 4 < 3 && value !== [42, 48, 60][i % 4]),
        name + ': image is empty',
      );
    return pixels;
  };
  return frame;
}
