/**
 * WebGPU's usage scopes and binding rules, as a device validates them when an encoder finishes:
 * each dispatch of a compute pass is one scope — the groups set when it runs and the buffer it
 * reads its arguments from —, a render pass is one — every group set in it and every buffer its
 * draws read their arguments from. A buffer read as indirect arguments and bound as writable
 * storage in one scope is refused ("usage (Indirect|Storage(read-write)) includes writable usage
 * and another usage in the same synchronization scope"), and the device is lost with the frame. So
 * is a group set with a number of dynamic offsets other than its layout's dynamic buffers, an
 * indirect buffer made without the INDIRECT usage, and a dispatch whose pipeline layout names a
 * group that is unset or whose layout is not the one set. A pass of the kit throws that error where
 * the device would refuse it.
 */

type Layout = {
  label?: string;
  entries?: Array<{ binding: number; buffer?: { type?: string; hasDynamicOffset?: boolean } }>;
};
type Group = { layout?: Layout; entries?: Array<{ binding: number; resource?: unknown }> };

/** The buffers `group` (a recorded descriptor) binds as writable storage: its layout's
 *  `storage` entries. */
export function writableBuffers(group: unknown) {
  const { layout, entries = [] } = (group ?? {}) as Group;
  const out: unknown[] = [];
  for (const entry of entries) {
    const type = layout?.entries?.find((e) => e.binding === entry.binding)?.buffer?.type;
    const buffer = (entry.resource as { buffer?: unknown } | undefined)?.buffer;
    if (type === 'storage' && buffer) out.push(buffer);
  }
  return out;
}

const refused = (buffer: unknown, where: string) =>
  new Error(
    `[Buffer "${(buffer as { label?: string }).label ?? ''}"] usage (Indirect|Storage(read-write)) ` +
      `includes writable usage and another usage in the same synchronization scope (${where})`,
  );

/** `GPUBufferUsage.INDIRECT`, the spec's bit: a scope runs where no WebGPU global is installed. */
const INDIRECT = 0x100;

/** The dynamic buffers of `group`'s layout, or undefined for a group the test made without one. */
function dynamicBuffers(group: unknown) {
  const entries = (group as Group | undefined)?.layout?.entries;
  return entries && entries.filter((e) => e.buffer?.hasDynamicOffset).length;
}

/** A layout's entries as one comparable text: two layouts with equal entries are one group. */
const entriesKey = (layout: Layout | undefined) =>
  layout?.entries &&
  JSON.stringify(
    [...layout.entries]
      .sort((a, b) => a.binding - b.binding)
      .map((e) => JSON.stringify(e, Object.keys(e).sort())),
  );

/** The scope of a compute pass's dispatches (`compute`) or of a render pass, fed as the pass is
 *  encoded: `setBindGroup`, `indirect`, `dispatch` and `end` throw what the device would refuse. */
export function createUsageScope(kind: 'compute' | 'render') {
  const set: unknown[] = [],
    everySet: unknown[] = [],
    indirect: unknown[] = [];
  let layouts: Layout[] | undefined;
  const writableIn = (groups: readonly unknown[], buffer: unknown) =>
    groups.some((group) => writableBuffers(group).includes(buffer));
  return {
    setBindGroup(index: number, group: unknown, offsets: readonly number[] = []) {
      const dynamic = dynamicBuffers(group);
      if (dynamic !== undefined && dynamic !== offsets.length)
        throw new Error(
          `The number of dynamic offsets (${offsets.length}) does not match the number of dynamic ` +
            `buffers (${dynamic}) in [BindGroupLayout "${(group as Group).layout?.label ?? ''}"]`,
        );
      set[index] = group;
      everySet.push(group);
    },
    /** The pipeline set: its layout's groups, when the device recorded them. */
    pipeline(p: unknown) {
      const layout = (p as { layout?: { bindGroupLayouts?: Layout[] } } | undefined)?.layout;
      layouts = layout?.bindGroupLayouts && [...layout.bindGroupLayouts];
    },
    /** A dispatch or draw runs: every group its pipeline layout names is set, with that layout. */
    dispatch(what: string) {
      if (!layouts) return;
      layouts.forEach((layout, k) => {
        const group = set[k] as Group | undefined;
        if (!group) throw new Error(`${what}: bind group ${k} is not set`);
        const want = entriesKey(layout),
          have = entriesKey(group.layout);
        if (want && have && want !== have)
          throw new Error(
            `${what}: the layout of bind group ${k} does not match the pipeline's [BindGroupLayout "${layout.label ?? ''}"]`,
          );
      });
    },
    /** A dispatch or draw reads its arguments from `buffer`. */
    indirect(buffer: unknown, what: string) {
      const usage = (buffer as { usage?: unknown }).usage;
      if (typeof usage === 'number' && !(usage & INDIRECT))
        throw new Error(
          `[Buffer "${(buffer as { label?: string }).label ?? ''}"] usage doesn't include BufferUsage::Indirect (${what})`,
        );
      if (kind === 'compute' && writableIn(set, buffer)) throw refused(buffer, what);
      indirect.push(buffer);
    },
    end() {
      if (kind === 'render')
        for (const buffer of indirect)
          if (writableIn(everySet, buffer)) throw refused(buffer, 'render pass');
    },
  };
}

/** One dispatch or draw a recording encoder saw: its pass, its pipeline's entry point, and the
 *  buffer and byte offset of an indirect one, or the groups of a direct dispatch. */
type RecordedCall = {
  pass: number;
  entry: string;
  buffer?: GPUBuffer;
  offset?: number;
  direct?: number;
};

/**
 * A command encoder that records every pass and every dispatch or draw, in order, under the usage
 * scopes the device enforces (`createUsageScope`), for a test that observes what a module encodes
 * on a `fakeDevice` (pipelines and groups are their descriptors there).
 */
export function recordingEncoder() {
  const calls: RecordedCall[] = [],
    renders: GPURenderPassDescriptor[] = [];
  let passes = 0,
    entry = '';
  const pass = (kind: 'compute' | 'render') => {
    const at = passes++,
      scope = createUsageScope(kind);
    return {
      setPipeline(p: { entryPoint?: string; vertex?: { entryPoint: string } }) {
        entry = p.entryPoint ?? p.vertex!.entryPoint;
        scope.pipeline(p);
      },
      setBindGroup: (index: number, group: unknown, offsets?: readonly number[]) =>
        scope.setBindGroup(index, group, offsets),
      dispatchWorkgroups(x: number) {
        scope.dispatch(entry);
        calls.push({ pass: at, entry, direct: x });
      },
      dispatchWorkgroupsIndirect(buffer: GPUBuffer, offset: number) {
        scope.dispatch(entry);
        scope.indirect(buffer, entry);
        calls.push({ pass: at, entry, buffer, offset });
      },
      drawIndirect(buffer: GPUBuffer, offset: number) {
        scope.indirect(buffer, entry);
        calls.push({ pass: at, entry, buffer, offset });
      },
      end: () => scope.end(),
    };
  };
  const encoder = {
    beginComputePass: () => pass('compute'),
    beginRenderPass: (descriptor: GPURenderPassDescriptor) => (
      renders.push(descriptor),
      pass('render')
    ),
    clearBuffer() {},
  } as unknown as GPUCommandEncoder;
  return { encoder, calls, renders };
}
