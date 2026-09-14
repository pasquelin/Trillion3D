import * as THREE from 'three';
import { createGpuPresenter } from './gpuPresentation.ts';

/** Sets up direct presentation or the canvas used by the WebGL composition host. */
export function prepareWebgpuPresentation(
  device: GPUDevice,
  scene: THREE.Scene,
  gpuCanvas: HTMLCanvasElement | undefined,
) {
  const outputCanvas =
    gpuCanvas ?? (typeof document !== 'undefined' ? document.createElement('canvas') : undefined);
  const presenter = outputCanvas ? createGpuPresenter(device, outputCanvas) : undefined;
  let canvasTexture: THREE.CanvasTexture | undefined;
  let blitMaterial: THREE.ShaderMaterial | undefined;
  let blit: THREE.Mesh | undefined;
  if (outputCanvas && !gpuCanvas) {
    canvasTexture = new THREE.CanvasTexture(outputCanvas);
    canvasTexture.colorSpace = THREE.SRGBColorSpace;
    canvasTexture.flipY = false;
    canvasTexture.generateMipmaps = false;
    canvasTexture.minFilter = THREE.NearestFilter;
    canvasTexture.magFilter = THREE.NearestFilter;
    blitMaterial = new THREE.ShaderMaterial({
      uniforms: { image: { value: canvasTexture } },
      vertexShader: 'void main(){gl_Position=vec4(position.xy,0.0,1.0);}',
      fragmentShader:
        'uniform sampler2D image;void main(){ivec2 sz=textureSize(image,0);gl_FragColor=texelFetch(image,ivec2(int(gl_FragCoord.x),sz.y-1-int(gl_FragCoord.y)),0);\n#include <colorspace_fragment>\n}',
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    blit = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), blitMaterial);
    blit.frustumCulled = false;
    blit.userData.blit = true;
    scene.add(blit);
  }
  return { presenter, canvasTexture, blitMaterial, blit };
}
