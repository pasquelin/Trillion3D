/**
 * How a relative import specifier names a file in this repository: `./x.ts` as written,
 * a directory or an extensionless path taking the `.ts` its siblings carry, and `../..` climbing.
 *
 * Every gate that reads the module graph needs this, and a second copy of it is how a gate ends up
 * reading a different file than the one the compiler read.
 */
export function normalized(from: string, specifier: string): string {
  const base = from.slice(0, from.lastIndexOf('/') + 1)
  const parts = (base + specifier).split('/')
  const stack: string[] = []
  for (const part of parts) {
    if (part === '.' || part === '') continue
    if (part === '..') stack.pop()
    else stack.push(part)
  }
  const path = stack.join('/')
  return path.endsWith('.ts') || path.endsWith('.mts') || path.endsWith('.json')
    ? path
    : path + '.ts'
}
