import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { parseAssetManifest, type Asset, type Evidence } from './asset-license-manifest.ts';

type Finding = { kind: 'technical' | 'policy' | 'review'; code: string };
/** Only the documented repository criteria are evaluated; no authenticity or legal certification. */
type AssetAudit = {
  id: string;
  declaration: Pick<Asset, 'source' | 'license' | 'licenseVersion' | 'usage' | 'sha256'>;
  status: 'matches-documented-criteria' | 'rejected' | 'review-required';
  findings: Finding[];
};

/** Stream large assets; never load an imported model merely to fingerprint it. */
async function verifyFile(root: string, ref: Evidence): Promise<boolean> {
  try {
    if (isAbsolute(ref.path)) return false;
    const file = await realpath(resolve(root, ref.path));
    const inside = relative(root, file);
    if (!inside || inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside))
      return false;
    const info = await stat(file);
    if (!info.isFile() || !info.size) return false;
    const hash = createHash('sha256');
    for await (const bytes of createReadStream(file)) hash.update(bytes);
    return hash.digest('hex') === ref.sha256;
  } catch {
    return false;
  }
}

async function auditAsset(root: string, asset: Asset): Promise<AssetAudit> {
  const findings: Finding[] = [];
  const add = (kind: Finding['kind'], code: string) => findings.push({ kind, code });
  if (!(await verifyFile(root, asset))) add('technical', 'asset-missing-or-hash-mismatch');
  try {
    const url = new URL(asset.source);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('source');
  } catch {
    add('technical', 'source-url-required');
  }
  const valid = new Set<string>();
  for (const [kind, ref] of Object.entries(asset.evidence)) {
    if (await verifyFile(root, ref)) valid.add(kind);
    else add('technical', `${kind}-missing-or-hash-mismatch`);
  }
  const requireEvidence = (kind: string) => {
    if (!valid.has(kind)) add('review', `${kind}-evidence-required`);
  };
  requireEvidence('terms');
  requireEvidence('acquisition');
  switch (asset.license) {
    case 'quixel-epic-engine':
      add('policy', 'epic-engine-plan-not-usable-in-trillion3d');
      break;
    case 'fab-standard':
    case 'unity-asset-store':
      if (asset.usage === 'raw-distribution' || asset.usage === 'public-demo')
        add('policy', 'standalone-asset-redistribution-not-permitted');
      break;
    case 'cc-by':
      requireEvidence('attribution');
      requireEvidence('changes');
      break;
    case 'owned':
      break;
    default:
      add('review', 'license-not-covered-by-documented-policy');
  }
  if (asset.usage === 'public-demo' || asset.usage === 'raw-distribution')
    requireEvidence('redistribution');
  return {
    id: asset.id,
    declaration: {
      source: asset.source,
      license: asset.license,
      licenseVersion: asset.licenseVersion,
      usage: asset.usage,
      sha256: asset.sha256,
    },
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
  const results: AssetAudit[] = [];
  for (const asset of assets) results.push(await auditAsset(root, asset));
  return {
    version: 1,
    policy: 'docs/COMPILER.md#content-licenses--independent-of-format',
    scope:
      'Declared license and usage checked against repository rules; local file integrity verified. Evidence authenticity, license interpretation and legal compliance are not certified.',
    results,
  };
}
