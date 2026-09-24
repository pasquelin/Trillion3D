/**
 * A device as WebGPU writes one, around the members a test device provides: an `EventTarget` (a
 * test raises `uncapturederror` with `raise`), a `lost` that settles on `lose`, one stack of error
 * scopes (an error raised under one is caught there, not dispatched), and creations that refuse a
 * `this` that is not the device ("Illegal invocation"). `given` records every descriptor a
 * creation received, `labels` the label each carried at that moment.
 */
export function asWebgpuDevice(members: Record<string, unknown>) {
  let settle: (info: { reason: string; message: string }) => void = () => {};
  const lost = new Promise<{ reason: string; message: string }>((resolve) => (settle = resolve));
  const given: Array<{ label?: string } | undefined> = [],
    labels: Array<string | undefined> = [],
    scopes: Array<object | null> = [];
  const target = new EventTarget();
  const device = Object.assign(target, members, {
    lost,
    pushErrorScope: () => void scopes.push(null),
    popErrorScope: async () => {
      if (!scopes.length) throw new DOMException('No error scope to pop', 'OperationError');
      return scopes.pop() ?? null;
    },
  }) as unknown as Record<string, unknown>;
  for (const key of Object.keys(members)) {
    const make = members[key];
    if (!key.startsWith('create') || typeof make !== 'function') continue;
    device[key] = function (this: unknown, descriptor?: { label?: string }) {
      if (this !== device) throw new TypeError('Illegal invocation');
      given.push(descriptor);
      labels.push(descriptor?.label);
      return make(descriptor);
    };
  }
  return {
    device: device as unknown as GPUDevice,
    given,
    labels,
    scopes,
    /** Raises an error: caught by the innermost scope open, dispatched as `uncapturederror`
     *  otherwise; returns whether a listener cancelled it. */
    raise(message: string, error: object = { message }) {
      if (scopes.length) {
        scopes[scopes.length - 1] ??= error;
        return false;
      }
      const event = Object.assign(new Event('uncapturederror', { cancelable: true }), { error });
      return !target.dispatchEvent(event);
    },
    lose: (reason = 'destroyed') => settle({ reason, message: reason }),
  };
}

/** An owner of a device claim (`claimGpuDevice`) that records what reaches it. */
export function deviceOwner() {
  const errors: string[] = [],
    reasons: string[] = [],
    closed: string[] = [],
    losses: string[] = [];
  return {
    errors,
    reasons,
    closed,
    losses,
    error: (message: string, reason: string) => (errors.push(message), reasons.push(reason)),
    closedError: (message: string) => closed.push(message),
    lost: (info: { reason: string }) => losses.push(info.reason),
  };
}
