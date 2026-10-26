/**
 * The cluster records of a pass of the residency, staged and sent in runs. A burst of arrivals
 * writes many thousands of records, each a few dozen bytes, and a `writeBuffer` apiece would cost
 * more than the words: each record staged is held once (the last put for a record stands), and the
 * flush sends every run of neighbouring records in one write, in increasing order. The records of
 * clusters never measured are listed for the GPU's measure (`../dag/info/measureWgsl.ts`).
 */
export function createInfoStage(
  device: GPUDevice,
  buffer: GPUBuffer,
  recordBytes: number,
  recordWords: number,
) {
  const slots = new Map<number, number>()
  const toMeasure = new Set<number>()
  let staged = new Uint32Array(64 * recordWords),
    run = new Uint32Array(64 * recordWords)
  return {
    /** Record `n` staged with `words` (`recordWords` of them, read now). */
    put(n: number, words: Uint32Array) {
      let at = slots.get(n)
      if (at === undefined) {
        at = slots.size
        slots.set(n, at)
        if ((at + 1) * recordWords > staged.length) {
          const grown = new Uint32Array(2 * staged.length)
          grown.set(staged)
          staged = grown
        }
      }
      staged.set(words.subarray(0, recordWords), at * recordWords)
    },
    /** Record `n` is a cluster the GPU has not measured. */
    measure: (n: number) => void toMeasure.add(n),
    /** Every record staged sent, run by run, then the clusters to measure told to `measure`. */
    flush(measure: (records: Uint32Array, count: number) => void) {
      if (slots.size) {
        const ns = Uint32Array.from(slots.keys()).sort()
        for (let first = 0; first < ns.length;) {
          let end = first + 1
          while (end < ns.length && ns[end] === ns[end - 1] + 1) end++
          const length = (end - first) * recordWords
          if (run.length < length) run = new Uint32Array(Math.max(length, 2 * run.length))
          for (let k = first; k < end; k++)
            run.set(
              staged.subarray(
                slots.get(ns[k])! * recordWords,
                (slots.get(ns[k])! + 1) * recordWords,
              ),
              (k - first) * recordWords,
            )
          const at = ns[first] * recordBytes
          // The buffer is sized for the cut's records (`packAppend` refuses a batch past it): a
          // record past its end is a broken invariant, never dropped, and stays staged.
          if (at + (end - first) * recordBytes > buffer.size)
            throw new RangeError(
              `Cluster records ${ns[first]}..${ns[end - 1]} lie past the info buffer (${buffer.size} bytes).`,
            )
          device.queue.writeBuffer(buffer, at, run.subarray(0, length))
          first = end
        }
        slots.clear()
      }
      if (toMeasure.size) {
        measure(Uint32Array.from(toMeasure), toMeasure.size)
        toMeasure.clear()
      }
    },
  }
}
