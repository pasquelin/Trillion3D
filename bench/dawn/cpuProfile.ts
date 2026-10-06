// Which functions the main thread spends its time in: V8's sampling profiler over the measured
// frames (`node:inspector`), summed by function — its own time, and the time under it.
import { Session } from 'node:inspector/promises'
import { relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { RACINE } from '../core/paths.ts'

type CallFrame = { functionName: string; url: string; lineNumber: number }
type ProfileNode = { id: number; callFrame: CallFrame; children?: number[] }
/** V8's profile: the call tree, and which node each sample fell in, `timeDeltas` µs apart. */
export type CpuProfile = { nodes: ProfileNode[]; samples: number[]; timeDeltas: number[] }

/** One function's time over the profile, ms: its own (`selfMs`) and with what it called. */
export type FunctionTime = { name: string; where: string; selfMs: number; totalMs: number }

/** Where a call frame's function lies, relative to the repository, with its line. */
function where({ url, lineNumber }: CallFrame) {
  if (!url) return ''
  const path = url.startsWith('file:') ? relative(RACINE, fileURLToPath(url)) : url
  return `${path}:${lineNumber + 1}`
}

/** Sums `profile` by function: each sample's interval goes to its function's own time and, once
 *  per function, to every function above it (a recursion counts once). Sorted by own time. */
export function functionTimes(profile: CpuProfile): FunctionTime[] {
  const parent = new Map<number, number>()
  for (const node of profile.nodes)
    for (const child of node.children ?? []) parent.set(child, node.id)
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]))
  const key = (frame: CallFrame) => `${frame.functionName || '(anonymous)'} ${where(frame)}`
  const times = new Map<string, FunctionTime>()
  const timeOf = (frame: CallFrame) => {
    const k = key(frame)
    let time = times.get(k)
    if (!time)
      times.set(
        k,
        (time = {
          name: frame.functionName || '(anonymous)',
          where: where(frame),
          selfMs: 0,
          totalMs: 0,
        }),
      )
    return time
  }
  profile.samples.forEach((id, i) => {
    const ms = (profile.timeDeltas[i + 1] ?? profile.timeDeltas[i] ?? 0) / 1000
    const seen = new Set<FunctionTime>()
    let at: number | undefined = id
    timeOf(nodes.get(id)!.callFrame).selfMs += ms
    while (at !== undefined) {
      const time = timeOf(nodes.get(at)!.callFrame)
      if (!seen.has(time)) {
        seen.add(time)
        time.totalMs += ms
      }
      at = parent.get(at)
    }
  })
  return [...times.values()].sort((a, b) => b.selfMs - a.selfMs)
}

/** Starts V8's profiler on this thread, sampling every `intervalUs`; the answer stops it and
 *  resolves to the profile. */
export async function startCpuProfile(intervalUs = 200) {
  const session = new Session()
  session.connect()
  await session.post('Profiler.enable')
  await session.post('Profiler.setSamplingInterval', { interval: intervalUs })
  await session.post('Profiler.start')
  return async () => {
    const { profile } = (await session.post('Profiler.stop')) as unknown as { profile: CpuProfile }
    session.disconnect()
    return profile
  }
}
