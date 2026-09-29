import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts';
import { createLightCutRedraws } from './lightCutRedraws.ts';
import { DRAW_FULL } from '../../../../sdk-core/src/scene/light-shadow/pool.ts';

/** Modes of pages drawn whole: static casters and moving ones. */
export const WHOLE = new Array<number>(8).fill(DRAW_FULL);

/** A light cut's flag readback whose word is `flag.value`, and one frame through it. */
export function redrawsWith(flag: { value: number }) {
  installGpuGlobals();
  const made: GPUBufferDescriptor[] = [];
  const buffer = (descriptor: GPUBufferDescriptor) => {
    made.push(descriptor);
    return {
      mapAsync: () => Promise.resolve(),
      getMappedRange: () => new Uint32Array(descriptor.size / 4).fill(flag.value).buffer,
      unmap() {},
    } as unknown as GPUBuffer;
  };
  const redraws = createLightCutRedraws(buffer, {} as GPUBuffer, 24);
  const encoder = { copyBufferToBuffer() {} } as unknown as GPUCommandEncoder;
  const taken = () => {
    const again: number[] = [];
    redraws.takeRedraw((page) => again.push(page));
    return again;
  };
  const frame = async (pages: number[], reported = true, views?: number[]) => {
    const settle = redraws.encode(encoder, pages, views ?? pages.map(() => 0), pages.length, WHOLE);
    redraws.reported(reported);
    settle?.(true);
    await redraws.settled();
    return taken();
  };
  return { redraws, encoder, frame, taken, made };
}
