/** A unit cube centred on the origin: eight vertices, twelve triangles, what the proxy's tests cut. */
export function cubeGeometry() {
  const positions = new Float32Array(24)
  for (let v = 0; v < 8; v++)
    positions.set([(v & 1) - 0.5, ((v >> 1) & 1) - 0.5, ((v >> 2) & 1) - 0.5], v * 3)
  const indices = Uint32Array.from(
    '0 2 1 1 2 3 4 5 6 5 7 6 0 1 4 1 5 4 2 6 3 3 6 7 0 4 2 2 4 6 1 3 5 3 7 5'.split(' '),
    Number,
  )
  return { indices, positions }
}
