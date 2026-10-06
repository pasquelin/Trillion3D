/** Snapshot the target and material switches at each submission, preserving call order. */
export function sourcePassDraws(calls: readonly { name: string; args: unknown[] }[]) {
  const uniforms: Record<string, unknown> = {}
  const draws: { target: unknown; count: unknown; flags: unknown[] }[] = []
  let target: unknown
  for (const call of calls) {
    if (call.name === 'bindFramebuffer') target = call.args[1]
    if (call.name === 'uniform1i')
      uniforms[(call.args[0] as { uniform: string }).uniform] = call.args[1]
    if (call.name === 'drawElements')
      draws.push({
        target,
        count: call.args[1],
        flags: [
          uniforms.reflectionCapture,
          uniforms.reflectionEnabled,
          uniforms.transmissive,
          uniforms.toneMapped,
          uniforms.fogFree,
        ],
      })
  }
  return draws
}
