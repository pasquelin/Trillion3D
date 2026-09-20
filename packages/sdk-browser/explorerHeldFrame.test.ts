// A Three-rendered engine submits nothing itself: a held frame redrew the whole scene while
// the engine had just said it could not change. It is now redisplayed by a fullscreen quad
// on an explicit copy of the drawing buffer — the canvas keeps nothing from frame to frame,
// `preserveDrawingBuffer` being false.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createHeldFrame } from './explorerHeldFrame.ts';

/** A render double: what it copied from the drawing buffer, and what it drew. */
function rendu() {
  const copies: THREE.Texture[] = [];
  const dessins: THREE.Scene[] = [];
  // Output space in force at each draw: that is what says whether the command re-encodes
  // what it puts back.
  const sorties: string[] = [];
  const renderer = {
    outputColorSpace: THREE.SRGBColorSpace,
    copyFramebufferToTexture: (texture: THREE.Texture) => copies.push(texture),
    render: (scene: THREE.Scene) => {
      dessins.push(scene);
      sorties.push(renderer.outputColorSpace);
    },
  } as unknown as THREE.WebGLRenderer;
  return { renderer, copies, dessins, sorties };
}

const taille = (x: number, y: number) => new THREE.Vector2(x, y);

test('nothing is kept until a complete frame has been copied', () => {
  const held = createHeldFrame();
  assert.equal(held.holds(taille(1280, 720)), false, 'the first frame must be drawn');
});

test('the kept frame is redisplayed by a single command, and nothing of the scene', () => {
  const { renderer, copies, dessins } = rendu();
  const held = createHeldFrame();
  held.keep(renderer, taille(1280, 720));
  assert.equal(copies.length, 1, 'the complete frame is copied once');
  assert.equal(held.holds(taille(1280, 720)), true);
  held.present(renderer);
  assert.equal(dessins.length, 1, 'one command, not a scene walked again');
  held.present(renderer);
  assert.equal(dessins.length, 2, 'each held frame costs exactly one command');
  assert.equal(copies.length, 1, 'a held frame copies nothing: it rereads what it set');
  // What is drawn is the kept-frame quad, never the engine scene.
  assert.equal(dessins[0], dessins[1]);
  assert.equal(dessins[0].children.length, 1, 'a single object: the fullscreen quad');
});

test('presentation does not retouch colour: the output is already encoded', () => {
  const { renderer, copies, dessins, sorties } = rendu();
  const held = createHeldFrame();
  held.keep(renderer, taille(1280, 720));
  held.present(renderer);
  const texture = copies[0]!;
  const materiau = (dessins[0]!.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial;
  // The copy stays a raw sample: an sRGB texture cannot receive the drawing buffer.
  assert.equal(texture.colorSpace, THREE.NoColorSpace);
  assert.equal(materiau.toneMapped, false, 'tone mapping has already been applied');
  assert.equal(materiau.map, texture, 'the quad does present the complete-frame copy');
  // The command that puts the copy back does not re-encode it, and the engine chain is restored afterwards.
  assert.deepEqual(sorties, [THREE.LinearSRGBColorSpace]);
  assert.equal(renderer.outputColorSpace, THREE.SRGBColorSpace);
});

test('a resize drops the kept frame: it no longer describes the target', () => {
  const { renderer } = rendu();
  const held = createHeldFrame();
  held.keep(renderer, taille(1280, 720));
  assert.equal(held.holds(taille(640, 360)), false, 'another size is not this image');
  held.keep(renderer, taille(640, 360));
  assert.equal(held.holds(taille(640, 360)), true);
  assert.equal(held.holds(taille(1280, 720)), false);
});
