import { nextPow2 } from '../../../../math/src/scalar/integers.ts'

/**
 * THE WORDS OF THE FEEDBACK BUFFER the read library writes (`sampleWgsl.ts`, `scWriteFeedback`): a header
 * that says where its parts are and the numbers of the image, then the elements — two words each, the
 * card and the level asked for, the page —, then the last read of each page of the page table by a
 * read that could have used a finer one, then the same for the reads of the coarse pages (`lastUsed`, which the scene view's mode 18 shows
 * beside the finest pages' `lastUsedHiRes`, mode 19). The header's words are
 * `FEEDBACK_AT`, which `sampleWgsl.ts` indexes the buffer by and `feedbackBuffer.ts` writes.
 */

/** The words of the header, which the read library indexes the buffer by. */
export const FEEDBACK_AT = {
  counter: 0,
  elements: 1,
  lastUsedHiRes: 2,
  size: 3,
  wrapMask: 4,
  jitterX: 5,
  jitterY: 6,
  frame: 7,
  resLevelBias: 8,
  lastUsed: 9,
} as const

/** The words the header takes, its place in the buffer to the first element. */
export const FEEDBACK_HEADER_WORDS = 16

/** The least pages the last-read part holds. */
const LEAST_PAGES = 256

/** Where the parts are, in words, for `elements` elements and a page table of `pages` records: the
 *  last-read part holds a power of two of pages at least `pages`. */
export function feedbackWords(elements: number, pages: number) {
  const capacity = Math.max(LEAST_PAGES, nextPow2(Math.max(1, pages)))
  const lastUsedHiRes = FEEDBACK_HEADER_WORDS + 2 * elements
  const lastUsed = lastUsedHiRes + capacity
  return {
    elements: FEEDBACK_HEADER_WORDS,
    lastUsedHiRes,
    lastUsed,
    pages: capacity,
    words: lastUsed + capacity,
  }
}
