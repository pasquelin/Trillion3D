/** Two queries: the blend pass, then the transmission pass. A pass that is not encoded leaves
 *  its query at zero, which the resolve writes itself. */
const QUERIES = 2,
  BYTES = QUERIES * 8;

export type BlendOverdraw = ReturnType<typeof createBlendOverdraw>;

/**
 * Overdraw count of transparents, by occlusion query: how many samples the pass lets through
 * the depth test, i.e. the fragments actually blended. Relating that to the frame's pixels
 * gives the pass's MEAN coverage; the per-pixel maximum is not measured here — an occlusion
 * query yields only a sum — and stays `null`.
 *
 * Diagnostic only: mounted by the `transparents-surdessin` variant and by it alone. The read
 * never blocks a frame: only one is in flight, later frames keep the last count that came back.
 */
export function createBlendOverdraw(device: GPUDevice) {
  const set = device.createQuerySet({ type: 'occlusion', count: QUERIES });
  const resolve = device.createBuffer({
    label: 'Trillion3D overdraw resolve',
    size: BYTES,
    usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
  });
  const read = device.createBuffer({
    label: 'Trillion3D overdraw readback',
    size: BYTES,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  let pending = false,
    encoded = false;
  const counts = {
    fragmentsMelanges: 0,
    pixelsImage: 0,
    /** Mean coverage in thousandths: a counter is an integer, never a duration. */
    recouvrementMoyenMillemes: 0,
    readings: 0,
  };
  return {
    set,
    /** Opens the pass query: zero for blend, one for transmission. */
    begin(pass: GPURenderPassEncoder, transmissive: boolean) {
      pass.beginOcclusionQuery(transmissive ? 1 : 0);
    },
    end(pass: GPURenderPassEncoder) {
      pass.endOcclusionQuery();
    },
    /** After the pass ends: resolves the queries, and copies one only when none is in flight. */
    after(encoder: GPUCommandEncoder) {
      encoder.resolveQuerySet(set, 0, QUERIES, resolve, 0);
      if (pending) return;
      encoder.copyBufferToBuffer(resolve, 0, read, 0, BYTES);
      encoded = true;
    },
    /** Once the frame is submitted: fetches the count when it comes back, never waiting for it. */
    pull(pixels: number) {
      if (!encoded || pending) return counts;
      encoded = false;
      pending = true;
      read
        .mapAsync(GPUMapMode.READ)
        .then(() => {
          const values = new BigUint64Array(read.getMappedRange());
          const fragments = Number(values[0]) + Number(values[1]);
          read.unmap();
          counts.fragmentsMelanges = fragments;
          counts.pixelsImage = pixels;
          counts.recouvrementMoyenMillemes = pixels ? Math.round((fragments / pixels) * 1000) : 0;
          counts.readings++;
        })
        .catch(() => {
          /* A lost frame or a released device cancels the read: the last count stays. */
        })
        .finally(() => {
          pending = false;
        });
      return counts;
    },
    dispose() {
      set.destroy();
      resolve.destroy();
      read.destroy();
    },
  };
}
