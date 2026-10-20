import { auditAssetManifest } from './asset-license-audit.ts'

// 0: every declaration matches; 1: policy rejection or review needed; 2: unusable input.
try {
  if (process.argv.length !== 3) throw new Error('Usage: pnpm audit:assets <manifest.json>')
  const report = await auditAssetManifest(process.argv[2])
  console.log(JSON.stringify(report, null, 2))
  const matched = report.results.every((r) => r.status === 'matches-documented-criteria')
  process.exitCode = matched ? 0 : 1
} catch (error) {
  console.error(JSON.stringify({ error: (error as Error).message }))
  process.exitCode = 2
}
