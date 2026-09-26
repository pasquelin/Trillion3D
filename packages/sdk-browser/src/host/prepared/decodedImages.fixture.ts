import type { TestContext } from 'node:test';

/** Images decoded to a one-pixel stand-in the size of their bytes, for the test `t`. */
export function decodingImages(t: TestContext) {
  const decode = async (blob: Blob) => ({ width: 1, height: 1, bytes: blob.size });
  // The loader reports progress with the browser's event and reads `self`: Node lacks both.
  class ProgressEvent extends Event {}
  const scope = globalThis as Record<string, unknown>;
  const stubs = { createImageBitmap: decode, ProgressEvent, self: globalThis };
  Object.assign(scope, stubs);
  t.after(() => {
    for (const name of Object.keys(stubs)) delete scope[name];
  });
}
