// The display graph the engine publishes with its transparent copies is a record it owns: a
// host reads the clear colour and walks the children, and prepare takes each copy back out.
import test from 'node:test';
import assert from 'node:assert/strict';
import { srgbToLinear } from '../sdk-core/src/index.ts';
import { createBlendScene } from './blendSceneRecord.ts';
import type { BlendCopy } from './blendCopyContract.ts';
import type { HostNode } from './hostResources.ts';

const copy = () => ({ userData: {}, renderOrder: 0 }) as unknown as BlendCopy & HostNode;

test('the published transparent graph carries the clear colour and gives its copies back', () => {
  const first = copy(),
    second = copy();
  const scene = createBlendScene(0x171d28, [first, second]);
  const background = scene.background as { isColor: boolean; r: number; g: number; b: number };
  assert.equal(background.isColor, true);
  assert.deepEqual(
    [background.r, background.g, background.b],
    [srgbToLinear(0x17 / 255), srgbToLinear(0x1d / 255), srgbToLinear(0x28 / 255)],
    'the background is linear, as every host reads a scene background',
  );
  const walked: HostNode[] = [];
  scene.traverse((node) => walked.push(node));
  assert.deepEqual(walked.slice(1), [first, second], 'the walk yields the scene, then its copies');
  scene.remove(first);
  assert.deepEqual(scene.children, [second], 'prepare takes a copy out once it has its GPU item');
  scene.clear();
  assert.deepEqual(scene.children, [], 'disposal empties the graph');
});
