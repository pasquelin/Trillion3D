// WGSL comments, which nest: the one reader the assembler and the tests that read WGSL skip them
// with.

/** The end of the comment opening at `i`, comments nesting in WGSL. */
export const commentEnd = (text: string, i: number) => {
  if (text[i + 1] === '/') {
    const end = text.indexOf('\n', i)
    return end < 0 ? text.length : end
  }
  let nested = 0
  do {
    if (text.startsWith('/*', i)) nested++
    else if (text.startsWith('*/', i)) nested--
    else {
      i++
      continue
    }
    i += 2
  } while (nested && i < text.length)
  return i
}

/** `text` with every comment, nested ones included, replaced by one blank. */
export function withoutComments(text: string) {
  let out = ''
  let from = 0
  for (let i = 0; i < text.length;) {
    if (text[i] === '/' && (text[i + 1] === '/' || text[i + 1] === '*')) {
      out += `${text.slice(from, i)} `
      i = from = commentEnd(text, i)
    } else i++
  }
  return out + text.slice(from)
}
