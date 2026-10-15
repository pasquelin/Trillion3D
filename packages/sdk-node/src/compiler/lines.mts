import { MIB } from '../../../math/src/constants.ts'
/** Longest accepted single line on either stream; the compiler emits small JSON lines only. */
export const COMPILER_LINE_LIMIT = 4 * MIB

/** Line-oriented JSON reader of both streams: feed it each chunk, then call its `end` when the
 *  stream closes, which hands over a last line left without its newline. A line that never ends
 *  is a protocol violation. */
export function lineReader(onLine: (line: string) => void, onOverflow: () => void) {
  let pending = ''
  const read = (chunk: string) => {
    pending += chunk
    if (pending.length > COMPILER_LINE_LIMIT) {
      onOverflow()
      return
    }
    const lines = pending.split('\n')
    pending = lines.pop() ?? ''
    for (const line of lines) {
      if (line.trim()) onLine(line)
    }
  }
  return Object.assign(read, {
    end() {
      if (pending.trim()) onLine(pending)
      pending = ''
    },
  })
}
