/** One assertion this proof recorded: either an image comparison or a captured pass list. */
export type CheckRecord =
  | { name: string; bytes: number; differentChannels: number; maxChannelError: number }
  | { name: string; passes: EncodedPass[] };

/** A GPU pass as a diagnostic capture names it, enough for the composition-shape checks below. */
export interface EncodedPass {
  name: string;
  colorAttachments?: number;
}

export function createChecks(checks: CheckRecord[]) {
  const check = (condition: unknown, message: string) => {
    if (!condition) throw Error(message);
  };
  const equal = (a: Uint8Array, b: Uint8Array, name: string) => {
    check(a.length === b.length, name + ': image dimensions differ');
    let differentChannels = 0,
      maxChannelError = 0;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) differentChannels++;
      maxChannelError = Math.max(maxChannelError, Math.abs(a[i] - b[i]));
    }
    checks.push({ name, bytes: a.length, differentChannels, maxChannelError });
    check(
      differentChannels === 0,
      name + ': ' + differentChannels + ' channels differ (max ' + maxChannelError + ')',
    );
  };
  const checkNormalPasses = (name: string, encoded: EncodedPass[]) => {
    const composition = encoded.filter((pass) => pass.name.startsWith('WG HDR composition'));
    check(
      composition.length === 1 && composition[0].colorAttachments === 2,
      name + ': expected one HDR composition with both display targets',
    );
    check(
      !encoded.some((pass) => pass.name === 'WG direct present'),
      name + ': redundant presentation pass',
    );
    checks.push({ name: name + ' passes', passes: encoded });
  };
  return { check, equal, checkNormalPasses };
}
