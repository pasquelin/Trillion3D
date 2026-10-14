/** A pass's parameters — the roots it runs over, how many roots its list holds, whether it runs
 *  over every root, and what else its `Params` holds —, one uniform block of `words` words (a
 *  multiple of four, the uniform's alignment) sent when one of them moved: a frame that runs under
 *  the same lists sends none. The composition's worlds and roots passes, the root boxes pass, the
 *  tree's leaves and the transparent entries' corners keep four words; the rows pass, eight
 *  (`../../placement/`). */
export const passParams = (label: string, words = 4) => ({
  label,
  buffer: undefined as GPUBuffer | undefined,
  words: new Uint32Array(words),
  written: false,
})
type PassParams = ReturnType<typeof passParams>

/** `params` written as the words `a`…`e`, in its `Params`' order — most passes `roots`, `listed`
 *  and `whole` —, those past its block left out, made at its first write; nothing sent when no
 *  word it holds moved. */
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
  const same =
    words[0] === a &&
    words[1] === b &&
    words[2] === c &&
    words[3] === d &&
    (words.length < 5 || words[4] === e)
  if (params.written && same) return
  words[0] = a
  words[1] = b
  words[2] = c
  words[3] = d
  if (words.length > 4) words[4] = e
  params.buffer ??= device.createBuffer({
    label: params.label,
    size: words.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  device.queue.writeBuffer(params.buffer, 0, words)
  params.written = true
}
