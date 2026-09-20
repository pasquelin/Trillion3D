#!/usr/bin/env node
// Stage immutable campaign evidence beside the portal; no network publication occurs here.
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { assertReport } from '../../docs/js/reports/contract.js';
import { parseArgs } from './options.mjs';
export function publierRapport(source, dest) {
  const report = assertReport(JSON.parse(readFileSync(join(source, 'report.json'), 'utf8')));
  const folder = join(dest, 'reports', report.id);
  if (existsSync(folder)) throw new Error('Campaign already published; use a new campaign ID');
  for (const path of [
    ...report.runs.map((run) => run.source),
    ...report.records.map((r) => r.image),
  ].filter(Boolean))
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
  writeFileSync(
    join(dest, 'report.html'),
    '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Measurements · Web Geometry</title><meta http-equiv="refresh" content="0;url=./#/en/reports"><a href="./#/en/reports">Measurements</a> · <a href="./#/fr/reports">Mesures</a></html>\n',
  );
  writeFileSync(join(dest, '.nojekyll'), '');
  return folder;
}
if (import.meta.filename === process.argv[1]) {
  const flags = parseArgs(process.argv.slice(2));
  console.log(
    publierRapport(
      resolve(flags.get('dossier') ?? '.mesure/out/global/report-data'),
      resolve(flags.get('vers') ?? 'docs'),
    ),
  );
}
