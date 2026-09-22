/**
 * The host display graph the transparent copies live in, and the lights the host sees on it.
 *
 * The engine draws none of it: prepare takes the copies out again as soon as it has built their
 * GPU items. The graph exists because the backend publishes a scene to its host, and building one
 * belongs to the boundary, never to the passes.
 */

import * as THREE from 'three';
import { asHostLibrary, type HostScene } from './hostResources.ts';
import type { BlendCopy } from './blendCopyContract.ts';

/** The published scene, plus the two writes the engine makes on it: taking a copy back out when
 *  prepare has its GPU item, and emptying it when the backend is disposed. */
export type BlendHostScene = HostScene & { remove(node: unknown): void; clear(): void };

export function createBlendHostScene(
  clearColor: number,
  copies: readonly BlendCopy[],
): BlendHostScene {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(clearColor);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x495061, 2));
  const light = new THREE.DirectionalLight(0xffffff, 2.5);
  light.position.set(1, 3, 2);
  scene.add(light);
  for (const copy of copies) scene.add(asHostLibrary<THREE.Object3D>(copy));
  return scene as unknown as BlendHostScene;
}
