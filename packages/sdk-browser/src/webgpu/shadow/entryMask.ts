import {
  shadowEntrySpan,
  shadowTableEntries,
} from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';

/** Mask of a listed request entry: every bit below the miss flag (`shadowRequestWgsl.ts`, bit 31),
 *  which lies above the most a `pages`-window table addresses. The ordinary window's table is a
 *  power of two, so this is its `entries - 1`, the mask it always was; a raised one is not, and the
 *  next power is the mask that keeps every entry and still clears the flag. */
export const shadowEntryMask = (pages: number) => shadowEntrySpan(shadowTableEntries(pages)) - 1;
