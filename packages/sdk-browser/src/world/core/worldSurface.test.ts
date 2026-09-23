import test from 'node:test';
import assert from 'node:assert/strict';
import { material } from '../../../../sdk-core/src/world/material/index.ts';
import { hostSurface, repaintHostSurface } from './worldSurface.ts';

// #335: a repainted entry writes its values into the surface the session already holds, and the
// version bump is what the page rows reread it on (`page/surface.ts`).
test('a repaint writes the values hostSurface writes, and bumps the surface version', () => {
  for (const kind of ['meshStandard', 'meshLambert'] as const) {
    const paint = material[kind]({ color: 0x3c8ce0, emissive: 0x000000 });
    const surface = hostSurface(paint, false, new Map()) as unknown as Record<string, unknown>;
    const version = surface.version as number;
    paint.color.set(0xff0000);
    paint.emissive.set(0x00ff00);
    paint.emissiveIntensity = 2;
    repaintHostSurface(surface as never, paint);
    const fresh = hostSurface(paint, false, new Map()) as unknown as Record<string, unknown>;
    for (const field of ['color', 'emissive'])
      assert.deepEqual(
        (surface[field] as { toArray(): number[] }).toArray(),
        (fresh[field] as { toArray(): number[] }).toArray(),
        `${kind} ${field}`,
      );
    assert.ok((surface.version as number) > version, `${kind}: the version moved`);
  }
});
