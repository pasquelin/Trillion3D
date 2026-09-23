#!/usr/bin/env node
// Stage immutable campaign evidence in the site's reports; no network publication occurs here.
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { assertReport } from '../../site/reports/contract.ts';
import { parseArgs } from './options.ts';
import { measureOutput } from '../core/paths.ts';
export function publierRapport(source: string, dest: string): string {
  const report = assertReport(JSON.parse(readFileSync(join(source, 'report.json'), 'utf8')));
  const folder = join(dest, 'reports', report.id);
  if (existsSync(folder)) throw new Error('Campaign already published; use a new campaign ID');
  for (const path of [
    ...report.runs.map((run) => run.source),
    ...report.records.map((r) => r.image),
  ].filter((p): p is string => Boolean(p)))
    if (!existsSync(join(source, path))) throw new Error(`Missing evidence: ${path}`);
  mkdirSync(join(dest, 'reports'), { recursive: true });
  cpSync(source, folder, { recursive: true });
  const indexPath = join(dest, 'reports/index.json');
  const index = existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, 'utf8')) : [];
  index.unshift({
    id: report.id,
    records: report.records.length,
    date:
      report.runs
        .map((run) => run.startedAt)
        .filter(Boolean)
        .sort()[0] ?? null,
  });
  writeFileSync(indexPath, JSON.stringify(index) + '\n');
  writeFileSync(join(dest, '.nojekyll'), '');
  return folder;
}
if (import.meta.filename === process.argv[1]) {
  const flags = parseArgs(process.argv.slice(2));
  console.log(
    publierRapport(
      resolve(flags.get('dossier') ?? measureOutput('global', 'report-data')),
      resolve(flags.get('vers') ?? 'site'),
    ),
  );
}
