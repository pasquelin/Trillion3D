import test from 'node:test';
import assert from 'node:assert/strict';
import { openMeasuredWorld } from '../../packages/sdk-browser/measurement.ts';
import { EngineError } from '../../packages/sdk-core/index.ts';

const CAS: Array<[label: string, body: string, status: number, type: string, code: string]> = [
  ['SPA HTML', '<!DOCTYPE html>', 200, 'text/html', 'INVALID_JSON_RESPONSE'],
  ['missing resource', 'missing', 404, 'text/plain', 'RESOURCE_HTTP_ERROR'],
  ['wrong pointer schema', '{}', 200, 'application/json', 'INVALID_POINTER'],
];
for (const [label, body, status, type, code] of CAS)
  test(label + ' is rejected before renderer creation', async (t) => {
    t.mock.method(
      globalThis,
      'fetch',
      async () => new Response(body, { status, headers: { 'Content-Type': type } }),
    );
    // A duck-typed target: `openMeasuredWorld` only reads `nodeName` and `getContext` before
    // rejecting on the manifest, well short of the full `HTMLCanvasElement` surface.
    const target = { nodeName: 'CANVAS', getContext() {} } as unknown as HTMLCanvasElement;
    await assert.rejects(
      openMeasuredWorld(target, {
        manifestUrl: 'http://localhost/cache/manifest.json',
        scope: 'full',
      }),
      (error: unknown) => {
        assert.ok(error instanceof EngineError);
        assert.equal(error.code, code);
        assert.match(error.message, /manifest\.json/);
        assert.equal(error.details.status, status);
        assert.equal(error.details.contentType, type);
        return true;
      },
    );
  });
