/** A pass's parameters — the roots it runs over, how many roots its list holds, whether it runs
 *  over every root, and what else its `Params` holds —, one uniform block sent when one of them
 *  moved: a frame that runs under the same lists sends none. The composition's worlds and roots
 *  passes, the root boxes pass, the tree's leaves, the rows pass (`../../placement/`) and the
 *  transparent entries' corners keep theirs so. */
export const passParams = (label: string) => ({
  label,
  buffer: undefined as GPUBuffer | undefined,
  words: new Uint32Array(PASS_PARAM_BYTES / 4),
  written: false,
})
type PassParams = ReturnType<typeof passParams>

/** Bytes of a pass's parameters (`passParams`): the widest `Params`, the rows pass's five words
 *  rounded up to the uniform's 16-byte alignment. */
export const PASS_PARAM_BYTES = 32

/** `params` written as the words `a`…`e`, in its `Params`' order — most passes `roots`, `listed`
 *  and `whole` —, made at its first write; nothing sent when no word moved. */
export function writePassParams(
  device: GPUDevice,
  params: PassParams,
  a: number,
  b: number,
  c = 0,
  d = 0,
  e = 0,
) {
  const { words } = params
  if (
    params.written &&
    words[0] === a &&
    words[1] === b &&
    words[2] === c &&
    words[3] === d &&
    words[4] === e
  )
    return
  words[0] = a
  words[1] = b
  words[2] = c
  words[3] = d
  words[4] = e
  params.buffer ??= device.createBuffer({
    label: params.label,
    size: PASS_PARAM_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  device.queue.writeBuffer(params.buffer, 0, words)
  params.written = true
}
