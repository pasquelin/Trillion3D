/**
 * Render bundles as the kits' devices make them: a bundle encoder records each command it takes,
 * in order, and the bundle it finishes is that list with the layout it was made for. A kit pass
 * replays it on itself (`replayBundles`): what a test observes of a pass — pipelines, groups,
 * draws, usage scopes — is what the bundle's commands would have done there.
 */
type FakeBundle = {
  descriptor: GPURenderBundleEncoderDescriptor
  commands: Array<[string, unknown[]]>
}

/** The commands a bundle encoder takes: those of a pass but its pass-level state. */
const COMMANDS = [
  'setPipeline',
  'setBindGroup',
  'setVertexBuffer',
  'setIndexBuffer',
  'draw',
  'drawIndexed',
  'drawIndirect',
  'drawIndexedIndirect',
  'pushDebugGroup',
  'popDebugGroup',
  'insertDebugMarker',
] as const

/** A bundle encoder for `descriptor`, each bundle it finishes pushed on `made` when given. */
export function fakeBundleEncoder(
  descriptor: GPURenderBundleEncoderDescriptor,
  made?: FakeBundle[],
): GPURenderBundleEncoder {
  const bundle: FakeBundle = { descriptor, commands: [] }
  const encoder: Record<string, unknown> = {
    finish: () => (made?.push(bundle), bundle),
  }
  for (const name of COMMANDS)
    encoder[name] = (...args: unknown[]) => void bundle.commands.push([name, args])
  return encoder as unknown as GPURenderBundleEncoder
}

/** A device's `createRenderBundleEncoder` (`make`) and the bundles it finished, in order. */
export function bundleMaker() {
  const made: FakeBundle[] = []
  return {
    made,
    make: (descriptor: GPURenderBundleEncoderDescriptor) => fakeBundleEncoder(descriptor, made),
  }
}

/** Replays on `pass` every command of `bundles`, in order, as a pass executes them. */
export function replayBundles(pass: object, bundles: Iterable<GPURenderBundle>) {
  const target = pass as Record<string, (...args: unknown[]) => unknown>
  for (const bundle of bundles)
    for (const [name, args] of (bundle as unknown as FakeBundle).commands) target[name](...args)
}
