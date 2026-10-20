import { BOUNCE_LIGHT_LIST_BINDING } from '../lightCellWgsl.ts'

/** The proxy in the probe pass (`probes.ts`): its buffer, the culling's records — the worlds it is
 *  placed by and its instances — and the placement tree its rays walk. */
export const PROBE_PROXY = { group: 0, proxy: 1, worlds: 7, tree: 8 } as const

/** The probe pass's bindings (`BOUNCE_PROBE_SHADER`), the one table its WGSL and its layout read:
 *  the cascades' uniform, the proxy, the lights, the queue, the frozen probes and the output — the
 *  atlases of `../atlas.ts` —, the world grid's light lists (`BOUNCE_LIGHT_LIST_BINDING`), and the
 *  culling's worlds the proxy is placed by and its placement tree (`PROBE_PROXY`). */
export const PROBE_BINDINGS = {
  grid: 0,
  proxy: PROBE_PROXY.proxy,
  lights: 2,
  queue: 3,
  snapshot: 4,
  probes: 5,
  lists: BOUNCE_LIGHT_LIST_BINDING,
  worlds: PROBE_PROXY.worlds,
  tree: PROBE_PROXY.tree,
} as const

/** The snapshot's follow-up's bindings (`BOUNCE_SNAPSHOT_SHADER`), read by its WGSL and its layout:
 *  the cascades' uniform, the queue, the probes it reads and the snapshot it writes. */
export const SNAPSHOT_BINDINGS = { grid: 0, queue: 1, probes: 2, snapshot: 3 } as const
