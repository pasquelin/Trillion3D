import {
  shadowEntrySpan,
  shadowTableEntries,
} from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';

/** Mask of a listed entry — a request, or the entry under a need key's rank (`shadowNeedKey`): every
 *  bit a `pages`-window table addresses. The ordinary window's table is a power of two, so this is
 *  its `entries - 1`, the mask it always was; a raised one is not, and the next power is the mask
 *  that keeps every entry and still clears the rank above it. */
export const shadowEntryMask = (pages: number) => shadowEntrySpan(shadowTableEntries(pages)) - 1;
