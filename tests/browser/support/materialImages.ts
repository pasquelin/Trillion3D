// The images of the material fixtures (`materialFixtures.ts`), drawn in the page on a canvas and
// handed to both engines as the same host texture.
//
// This module is SERVED to the harness page and imported by its URL, like the fixtures.
import * as THREE from 'three';

/** A 2×2 image whose texels colour the four quadrants of the square: top-left, top-right,
 *  bottom-left, bottom-right on screen (`flipY` off, plane UVs). */
function quadrantImage(texels: [number, number, number, number][]): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 2;
  const ctx = canvas.getContext('2d')!;
  const at = [
    [0, 1],
    [1, 1],
    [0, 0],
    [1, 0],
  ];
  texels.forEach(([r, g, b, a], i) => {
    ctx.fillStyle = `rgba(${r},${g},${b},${a / 255})`;
    ctx.fillRect(at[i][0], at[i][1], 1, 1);
  });
  return canvas;
}

/** A texture the two engines read the same way: nearest, unrepeated, in the declared space. */
export function texture(
  texels: [number, number, number, number][],
  colorSpace: THREE.ColorSpace = THREE.NoColorSpace,
): THREE.CanvasTexture {
  const map = new THREE.CanvasTexture(quadrantImage(texels));
  map.colorSpace = colorSpace;
  map.magFilter = map.minFilter = THREE.NearestFilter;
  map.generateMipmaps = false;
  map.flipY = false;
  return map;
}

/** An 8×8 black-and-white checker, nearest under magnification: a mixed read — the one sampler
 *  every map had on WebGPU before #361 — puts a fifth to a third of the neighbour texel into each point
 *  read below, a nearest read returns the texel alone. */
export function checkerMap(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 8;
  const ctx = canvas.getContext('2d')!;
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++) {
      ctx.fillStyle = (x + y) % 2 ? '#ffffff' : '#000000';
      ctx.fillRect(x, y, 1, 1);
    }
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.magFilter = map.minFilter = THREE.NearestFilter;
  map.generateMipmaps = false;
  map.flipY = false;
  return map;
}

/** Black and white stripes one texel wide, running along V, repeated four times each way, with
 *  the host's mip chain and trilinear filters: across the stripes only U varies, so a footprint
 *  squeezed along V blurs them at the isotropic level and keeps them at the anisotropic one. */
export function stripeMap(anisotropy: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 8;
  const ctx = canvas.getContext('2d')!;
  for (let x = 0; x < 8; x++) {
    ctx.fillStyle = x % 2 ? '#ffffff' : '#000000';
    ctx.fillRect(x, 0, 1, 8);
  }
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(4, 4);
  map.anisotropy = anisotropy;
  map.flipY = false;
  return map;
}

/** A base-colour map of four quadrants, in sRGB like every base colour. */
export const colourMap = (texels: [number, number, number, number][]) =>
  texture(texels, THREE.SRGBColorSpace);
