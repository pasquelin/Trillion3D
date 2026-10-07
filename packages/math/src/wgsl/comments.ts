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
