/** A pass's parameters — the roots it runs over, how many roots its list holds, whether it runs
 *  over every root —, one uniform block sent when one of them moved: a frame that runs under the
 *  same lists sends none. The composition's worlds and roots passes, the root boxes pass, the
 *  tree's leaves (`../../placement/`) and the transparent entries' corners keep theirs so. */
export const passParams = (label: string) => ({
  label,
  buffer: undefined as GPUBuffer | undefined,
  words: new Uint32Array(4),
  written: false,
})
type PassParams = ReturnType<typeof passParams>

/** Bytes of a pass's parameters (`passParams`). */
export const PASS_PARAM_BYTES = 16

/** `params` written for `roots` roots and `listed` listed ones — every root when `whole` —, made
 *  at its first write. */
export function writePassParams(
  device: GPUDevice,
  params: PassParams,
  roots: number,
  listed: number,
  whole = 0,
) {
  const { words } = params
  if (params.written && words[0] === roots && words[1] === listed && words[2] === whole) return
  words[0] = roots
  words[1] = listed
  words[2] = whole
  params.buffer ??= device.createBuffer({
    label: params.label,
    size: PASS_PARAM_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  device.queue.writeBuffer(params.buffer, 0, words)
  params.written = true
}
