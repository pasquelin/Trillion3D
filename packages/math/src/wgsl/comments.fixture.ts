// The tests' WGSL read without its comments, by the assembler's own comment reader.
import { commentEnd } from './comments.ts'

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
