import { writeDepthRamp } from '../../camera/depthConvention.ts';
import type { Side } from '../../../../sdk-core/src/index.ts';
import { type Material } from './materialMaps.ts';
import { type Binding, bindClusterMaterial } from './bindClusterMaterial.ts';

export type { Material };
/** The frame's depth ramp: the fragment holds the view distance, so the perspective weights. */
const ramp = new Float32Array(3);
/** Units after the six material maps: the frozen backdrop colour, then its depth. */
export const BACKDROP_UNITS: [number, number] = [6, 7];

/**
 * The material of the last submission, its pass and its layer: a mesh wearing the same one draws
 * on the uniforms, maps and raster state already set. `forget` at every frame and every change of
 * destination — a surface may be rewritten between frames without a version.
 */
export class ClusterMaterialPass {
  private binding: Binding;
  private material: Material | undefined;
  private toneMapped = false;
  private side: Side | undefined;
  private offset: number | undefined;
  constructor(binding: Binding) {
    this.binding = binding;
  }
  bind(material: Material, toneMapped: boolean, side?: Side, offset?: number) {
    if (
      material === this.material &&
      toneMapped === this.toneMapped &&
      side === this.side &&
      offset === this.offset
    )
      return;
    bindClusterMaterial(this.binding, material, toneMapped, side, offset);
    this.material = material;
    this.toneMapped = toneMapped;
    this.side = side;
    this.offset = offset;
  }
  forget() {
    this.material = undefined;
  }
  /** Image pixels per CSS pixel, written by the owner before a frame: a line's width scale; and
   *  the frame's texture level offset (`upscaleMipBias`), zero at the display's size. */
  pixelRatio = 1;
  mipBias = 0;
  /** A new frame: nothing bound yet, the ramp a depth material shows under its camera, the size
   *  in pixels of the image a line is widened in — the viewport's `[x, y, w, h]` — and the image
   *  pixels per CSS pixel its width is scaled by. */
  beginFrame(camera: { near: number; far: number }, viewport: ArrayLike<number>) {
    this.forget();
    writeDepthRamp(ramp, 0, camera.near, camera.far, 1);
    this.binding.uniforms.f2(36, 'depthRamp', ramp[0], ramp[1]);
    this.binding.uniforms.f2(40, 'viewport', viewport[2], viewport[3]);
    this.binding.uniforms.f1(42, 'pixelRatio', this.pixelRatio);
    this.binding.uniforms.f1(48, 'mipBias', this.mipBias);
  }
}
