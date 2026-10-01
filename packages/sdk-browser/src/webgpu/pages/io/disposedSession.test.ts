// #990: a session disposed while its work is pending — the static shadow layer the first move
// allocates, its pyramids and occlusion test — cancels that work silently: the released device
// makes it throw, and that is its cancellation, not a failure. A device that fails under a live
// session still reports by name.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SUN } from '../../../../../sdk-core/src/scene/light-shadow/lightShadow.fixture.ts';
import { along, camera } from '../testScenes.fixture.ts';
import { floorCasterBackend } from '../../shadow/floorCaster.fixture.ts';
import { SHADOW_LAYER_PASS } from '../../../stage/passLabels.ts';

/** A caster over a floor, lit by the sun, moved once: its static layer is on its way. `fail`
 *  breaks the device's layouts from then on; `dispose` closes the session before it lands; `late`
 *  closes it once the layer is made, while its occlusion test is being made. Returns what the
 *  session said, and whether every static layer made was freed. */
async function pendingStaticLayer(end: 'dispose' | 'fail' | 'late') {
  const said: string[] = [];
  const { backend, gpu } = await floorCasterBackend(SUN, {
    diagnosticDetail: 'summary',
    onDiagnostic: ({ phase }) => void said.push(phase),
  });
  const view = camera();
  backend.render(view);
  await backend.flush?.();
  backend.setTransform!('caster', along(0.1));
  backend.render(view);
  said.length = 0;
  if (end === 'fail')
    (gpu.device as unknown as { createBindGroupLayout: () => never }).createBindGroupLayout =
      () => {
        throw new Error('device failed');
      };
  else if (end === 'dispose') void backend.dispose();
  else {
    const device = gpu.device as unknown as { createBuffer: (d: GPUBufferDescriptor) => unknown };
    const make = device.createBuffer.bind(device);
    device.createBuffer = (descriptor) => {
      if (descriptor.label?.startsWith('Trillion3D shadow visible casters')) void backend.dispose();
      return make(descriptor);
    };
  }
  for (let tick = 0; tick < 8; tick++) await new Promise((next) => setTimeout(next, 0));
  if (end === 'fail') void backend.dispose();
  const layers = gpu.textures.filter(({ label }) => label?.startsWith(SHADOW_LAYER_PASS));
  assert.ok(layers.length, 'a static layer was on its way');
  return { said, freed: layers.every(({ destroyed }) => destroyed) };
}

test('a session disposed before its static shadow layer lands says nothing', async (t) => {
  const warned = t.mock.method(console, 'warn', () => {});
  const { said, freed } = await pendingStaticLayer('dispose');
  assert.deepEqual(said, []);
  assert.ok(freed, 'the layer on its way is freed');
  assert.deepEqual(
    warned.mock.calls.map((call) => call.arguments[0]),
    [],
  );
});

test('a static layer that lands after its session is disposed is freed, silently', async (t) => {
  const warned = t.mock.method(console, 'warn', () => {});
  const { said, freed } = await pendingStaticLayer('late');
  assert.deepEqual(said, []);
  assert.ok(freed, 'the layer that landed is freed');
  assert.equal(warned.mock.callCount(), 0);
});

test('a device that fails under a live session still reports the static layer by name', async (t) => {
  t.mock.method(console, 'warn', () => {});
  assert.ok((await pendingStaticLayer('fail')).said.includes('shadow-static-layer-unavailable'));
});
