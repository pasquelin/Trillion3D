// The projection loads the shadow receiver's texel beside the surface's (`vsmSurfaceOf`), at
// `coord`, the pixel `shadowReceiver(svPosition.xy)` reads in the rect, and decodes it past the
// return of a pixel no light shades, with `shadowReceiverOf`, the decode `shadowReceiver` itself
// calls (`receiverOffsetReaders.test.ts` runs it).
import test from 'node:test';
import assert from 'node:assert/strict';
import { vsmLayout } from './resources.ts';
import { vsmProjectionWgsl } from './projectionWgsl.ts';

const LAYOUT = vsmLayout({ fullMapCapacity: 7, sunMapCapacity: 3 }, 2 ** 27);

test('the receiver texel is loaded with the surface reads and decoded for a lit pixel alone', () => {
  for (const subgroups of [false, true]) {
    const code = vsmProjectionWgsl(LAYOUT, { subgroups, receiver: true });
    const load = code.indexOf('let receiverTexel=shadowReceiverTexel(vec2i(coord));'),
      shading = code.indexOf(
        'p.info=vsmSurfaceOf(coord,p.inRect,textureLoad(vsmNormalRough,coord,0).xyz);',
      ),
      unlit = code.indexOf('if(!p.info.valid){return p;}'),
      decode = code.indexOf('let receiver=shadowReceiverOf(receiverTexel);');
    assert.ok(
      load > 0 && load < shading && shading < unlit && unlit < decode,
      'load, surface, the unlit pixel out, then its decode',
    );
    assert.doesNotMatch(code, /receiver=shadowReceiver\(/);
  }
});
