import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { parseAssetManifest, type Asset, type Evidence } from './asset-license-manifest.ts';

type Finding = { kind: 'technical' | 'policy' | 'review'; code: string };
/** Only the documented repository criteria are evaluated; no authenticity or legal certification. */
type AssetAudit = {
  id: string;
  declaration: Omit<Asset, 'id' | 'path' | 'evidence'>;
  status: 'matches-documented-criteria' | 'rejected' | 'review-required';
  findings: Finding[];
};
/** One digest per real file per run: evidence shared by many assets is read once. */
type Digests = Map<string, Promise<string | undefined>>;

/** Stream large assets; never load an imported model merely to fingerprint it. */
async function digest(file: string): Promise<string | undefined> {
  const info = await stat(file);
  if (!info.isFile() || !info.size) return undefined;
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(file)) hash.update(bytes);
  return hash.digest('hex');
}

async function verifyFile(root: string, ref: Evidence, digests: Digests): Promise<boolean> {
  try {
    const file = await realpath(resolve(root, ref.path));
    const inside = relative(root, file);
    if (!inside || inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside))
      return false;
    if (!digests.has(file)) digests.set(file, digest(file));
    return (await digests.get(file)) === ref.sha256;
  } catch {
    return false;
  }
}

async function auditAsset(root: string, asset: Asset, digests: Digests): Promise<AssetAudit> {
  const { id, path, evidence, ...declaration } = asset;
  const findings: Finding[] = [];
  const add = (kind: Finding['kind'], code: string) => findings.push({ kind, code });
  if (!(await verifyFile(root, { path, sha256: asset.sha256 }, digests)))
    add('technical', 'asset-missing-or-hash-mismatch');
  try {
    const url = new URL(asset.source);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('source');
  } catch {
    add('technical', 'source-url-required');
  }
  const valid = new Set<string>();
  for (const [kind, ref] of Object.entries(evidence)) {
    if (await verifyFile(root, ref, digests)) valid.add(kind);
    else add('technical', `${kind}-missing-or-hash-mismatch`);
  }
  const requireEvidence = (kind: string) => {
    if (!valid.has(kind)) add('review', `${kind}-evidence-required`);
  };
  const publishes = asset.usage === 'public-demo' || asset.usage === 'raw-distribution';
  requireEvidence('terms');
  requireEvidence('acquisition');
  switch (asset.license) {
    case 'quixel-epic-engine':
      add('policy', 'epic-engine-plan-not-usable-in-trillion3d');
      break;
    case 'fab-standard':
    case 'unity-asset-store':
      if (publishes) add('policy', 'standalone-asset-redistribution-not-permitted');
      break;
    case 'cc-by':
      requireEvidence('attribution');
      requireEvidence('changes');
      break;
    case 'owned':
      // Ownership rests on the terms and acquisition evidence required above.
      break;
    default:
      add('review', 'license-not-covered-by-documented-policy');
  }
  if (publishes) requireEvidence('redistribution');
  return {
    id,
    declaration,
    status: findings.some((f) => f.kind === 'policy')
      ? 'rejected'
      : findings.length
        ? 'review-required'
        : 'matches-documented-criteria',
    findings,
  };
}

/** Paths are relative to the manifest; symlinks cannot extend its evidence root. */
export async function auditAssetManifest(file: string) {
  const root = await realpath(dirname(resolve(file)));
  const assets = parseAssetManifest(JSON.parse(await readFile(file, 'utf8')));
  const digests: Digests = new Map();
  const results: AssetAudit[] = [];
  for (const asset of assets) results.push(await auditAsset(root, asset, digests));
  return {
    version: 1,
    policy: 'docs/COMPILER.md#content-licenses--independent-of-format',
    scope:
      'Declared license and usage checked against repository rules; local file integrity verified. Evidence authenticity, license interpretation and legal compliance are not certified.',
    results,
  };
}
