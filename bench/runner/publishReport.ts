#!/usr/bin/env node
// Stage a campaign's evidence as the site's one report, replacing the one before; no network use.
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { assertReport } from '../../site/reports/contract.ts';
import { parseArgs } from './options.ts';
import { measureOutput } from '../core/paths.ts';
export function publierRapport(source: string, dest: string): string {
  const report = assertReport(JSON.parse(readFileSync(join(source, 'report.json'), 'utf8')));
  const reports = join(dest, 'reports'),
    folder = join(reports, report.id);
  if (existsSync(folder)) throw new Error('Campaign already published; use a new campaign ID');
  for (const path of [
    ...report.runs.map((run) => run.source),
    ...report.records.map((r) => r.image),
  ].filter((p): p is string => Boolean(p)))
    if (!existsSync(join(source, path))) throw new Error(`Missing evidence: ${path}`);
  mkdirSync(reports, { recursive: true });
  cpSync(source, folder, { recursive: true });
  // Copied first, so a failed copy keeps the old report; the report modules are files, not folders.
  for (const entry of readdirSync(reports, { withFileTypes: true }))
    if (entry.isDirectory() && entry.name !== report.id)
      rmSync(join(reports, entry.name), { recursive: true });
  const date =
    report.runs
      .map((run) => run.startedAt)
      .filter(Boolean)
      .sort()[0] ?? null;
  const index = [{ id: report.id, records: report.records.length, date }];
  writeFileSync(join(reports, 'index.json'), JSON.stringify(index) + '\n');
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
