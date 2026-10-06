/** Longest accepted single line on either stream; the compiler emits small JSON lines only. */
export const COMPILER_LINE_LIMIT = 4 * 1024 * 1024

/** Line-oriented JSON reader shared by both streams; a line that never ends is a protocol violation. */
export function lineReader(onLine: (line: string) => void, onOverflow: () => void) {
  let pending = ''
  return (chunk: string) => {
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
}
