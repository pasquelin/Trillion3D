import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts';

/** A texture device that notes copies, by their origins, and destroyed textures. */
export function textureDevice() {
  const { device, textures, textureCopies, destroyed } = fakeDevice();
  return {
    gpu: device,
    copies: () =>
      textureCopies.map(({ from, to, size }) => ({
        from: from.origin as number[] | undefined,
        to: to.origin as number[] | undefined,
        size: size as number[],
      })),
    destroyed: () => destroyed.filter((resource) => textures.includes(resource as never)).length,
  };
}
