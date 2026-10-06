// Recette-only reference pose: original public glTF, independent Three animation evaluation.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { octets } from './threeBareScene.ts';
import { posterCapture } from '../harness/measurePage.ts';

/** Source graph and mixers for the walking/crowd and morph examples; no engine implementation. */
export async function deformationWitness(source: string, count: 1 | 10 | 100) {
  const gltf = await new GLTFLoader().loadAsync(source);
  if (!gltf.animations[0]) throw new Error('DEFORMATION_REFERENCE_CLIP_MISSING');
  const root = new THREE.Group(),
    mixers: THREE.AnimationMixer[] = [];
  const columns = Math.ceil(Math.sqrt(count));
  for (let i = 0; i < count; i++) {
    const graph = clone(gltf.scene);
    graph.position.set(((i % columns) - (columns - 1) / 2) * 2, 0, Math.floor(i / columns) * 2);
    root.add(graph);
    const mixer = new THREE.AnimationMixer(graph);
    mixer.clipAction(gltf.animations[0]).play();
    mixers.push(mixer);
  }
  return {
    root,
    setTime(seconds: number) {
      for (const mixer of mixers) mixer.setTime(seconds);
      root.updateMatrixWorld(true);
    },
    memory: () => octets(root),
    dispose() {
      for (const mixer of mixers) {
        mixer.stopAllAction();
        mixer.uncacheRoot(mixer.getRoot());
      }
      const geometries = new Set<THREE.BufferGeometry>();
      const materials = new Set<THREE.Material>();
      root.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (mesh.geometry) geometries.add(mesh.geometry);
        if (mesh.material) for (const material of [mesh.material].flat()) materials.add(material);
      });
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
    },
  };
}

/** Use the existing capture transport/image-diff path; caller supplies identical lights/camera. */
export async function captureDeformationWitness(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  file: string,
) {
  renderer.render(scene, camera);
  const gl = renderer.getContext(),
    width = gl.drawingBufferWidth,
    height = gl.drawingBufferHeight;
  const pixels = new Uint8Array(width * height * 4);
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  return posterCapture(file, pixels, width, height);
}
