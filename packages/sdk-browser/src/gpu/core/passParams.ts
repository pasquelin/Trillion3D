import { writeChanged } from './writeChanged.ts'

/** A pass's parameters — the roots it runs over, how many roots its list holds, whether it runs
 *  over every root, and what else its `Params` holds —, one uniform block of four words sent when
 *  one of them moved: a frame that runs under the same lists sends none. */
export const passParams = (label: string) => ({
  label,
  buffer: undefined as GPUBuffer | undefined,
  words: new Uint32Array(4),
})
type PassParams = ReturnType<typeof passParams>

/** `params` written as the words `a`…`d`, in its `Params`' order — most passes `roots`, `listed`
 *  and `whole` —, its buffer made at its first write; the words that
 *  moved go up through the engine's one changed-words write (`writeChanged`). */
export function writePassParams(
  device: GPUDevice,
  params: PassParams,
  a: number,
  b: number,
  c = 0,
  d = 0,
) {
  const { words } = params
  words[0] = a
  words[1] = b
  words[2] = c
  words[3] = d
  params.buffer ??= device.createBuffer({
    label: params.label,
    size: words.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  writeChanged(device, params.buffer, words, 0, words.length)
}
