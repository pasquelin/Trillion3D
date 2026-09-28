/** Versioned declarations and evidence references; these are assertions, not legal verdicts. */
const USAGES = ['internal', 'embedded-product', 'public-demo', 'raw-distribution'] as const;
const EVIDENCE = ['terms', 'acquisition', 'redistribution', 'attribution', 'changes'] as const;
export type Evidence = { path: string; sha256: string };
export type Asset = {
  id: string;
  path: string;
  sha256: string;
  source: string;
  license: string;
  licenseVersion: string;
  usage: (typeof USAGES)[number];
  evidence: Partial<Record<(typeof EVIDENCE)[number], Evidence>>;
};

const HASH = /^[a-f0-9]{64}$/;
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';
const hash = (value: unknown) => typeof value === 'string' && HASH.test(value);
const member = (list: readonly string[], value: unknown) => list.includes(value as string);

/** Strict shape checks distinguish an unusable manifest from an unresolved license. */
export function parseAssetManifest(value: unknown): Asset[] {
  if (!object(value) || value.version !== 1 || !Array.isArray(value.assets) || !value.assets.length)
    throw new Error('Expected version 1 and a nonempty assets array');
  const ids = new Set<string>();
  const paths = new Set<string>();
  return value.assets.map((entry: unknown, index: number) => {
    const fail = () => {
      throw new Error(`Invalid asset declaration at index ${index}`);
    };
    if (!object(entry)) return fail();
    for (const key of ['id', 'path', 'source', 'license', 'licenseVersion'])
      if (!text(entry[key])) return fail();
    if (!hash(entry.sha256) || !member(USAGES, entry.usage) || !object(entry.evidence))
      return fail();
    for (const [key, ref] of Object.entries(entry.evidence))
      if (!member(EVIDENCE, key) || !object(ref) || !text(ref.path) || !hash(ref.sha256))
        return fail();
    const asset = entry as Asset;
    if (ids.has(asset.id) || paths.has(asset.path)) return fail();
    ids.add(asset.id);
    paths.add(asset.path);
    return asset;
  });
}
