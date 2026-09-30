/**
 * The documentation of the message catalogue (`packages/sdk-node/src/messages/messages.json`): one
 * page per code under `docs/messages/`, the page each message links to, and the index
 * `docs/COMPILER_ERRORS.md`, one table per group. Both are generated, never edited:
 * `pnpm run generate:messages` writes them, `--check` fails when they lag the catalogue.
 */
import { readdirSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  catalogueMessages,
  type CatalogueMessage,
} from '../packages/sdk-node/src/messages/catalogue.mts';
import { slug } from './check-links.ts';

const MESSAGES_DIRECTORY = 'docs/messages';
const MESSAGES_INDEX = 'docs/COMPILER_ERRORS.md';
const LEVEL = { error: 'error', warn: 'warning', info: 'info' } as const;
const GENERATED =
  '<!-- Generated from packages/sdk-node/src/messages/messages.json by scripts/message-pages.ts: edit the catalogue, then run `pnpm run generate:messages`. -->';
/** A cause written for `docs/` keeps its relative links working one folder down. */
const fromSubfolder = (text: string) => text.replace(/\]\((?!https?:|#)/g, '](../');
const cell = (text: string) => text.replaceAll('|', '\\|');

function page(entry: CatalogueMessage) {
  return [
    `# ${entry.id} — \`${entry.code}\``,
    '',
    GENERATED,
    '',
    `Level: **${LEVEL[entry.level]}**. Group: [${entry.group}](../COMPILER_ERRORS.md#${slug(entry.group)}).`,
    '',
    entry.message,
    '',
    `**Cause.** ${fromSubfolder(entry.cause)}`,
    '',
    `**What to do.** ${entry.action}`,
    '',
  ].join('\n');
}

function index(messages: readonly CatalogueMessage[]) {
  const groups = [...new Set(messages.map((entry) => entry.group))];
  const lines = [
    '# Compiler message codes',
    '',
    GENERATED,
    '',
    'Every message of the compiler and of its Node adapter has a stable public code, one sentence,',
    'its cause and the action to take, each on its own page. `T3D-Exxx` is an error: the job',
    'publishes nothing. `T3D-Wxxx` is a warning: always told, it never stops a compile that can',
    'succeed (`trillion3d-compile --strict` fails on it). `T3D-Ixxx` is an info, told on request',
    '(`--verbose`). The events and the cache keep writing the symbolic name as `code`; the',
    'catalogue maps it to its public code. Exit codes and message prefixes:',
    '[COMPILER.md](COMPILER.md#exit-codes-and-error-codes).',
  ];
  for (const group of groups) {
    lines.push(
      '',
      `## ${group}`,
      '',
      '| Code | Name | Level | Message |',
      '| --- | --- | --- | --- |',
    );
    for (const entry of messages.filter((m) => m.group === group))
      lines.push(
        `| [${entry.id}](messages/${entry.id}.md) | \`${entry.code}\` | ${LEVEL[entry.level]} | ${cell(entry.message)} |`,
      );
  }
  return `${lines.join('\n')}\n`;
}

/** Every generated file, by path from the repository root. */
function messagePages(messages: readonly CatalogueMessage[] = catalogueMessages) {
  const files = new Map<string, string>([[MESSAGES_INDEX, index(messages)]]);
  for (const entry of messages) files.set(`${MESSAGES_DIRECTORY}/${entry.id}.md`, page(entry));
  return files;
}

/** The generated files that differ from the disk under `root`, pages left over included. */
export function stalePages(root: string) {
  const files = messagePages();
  const stale = [...files].filter(([path, text]) => {
    try {
      return readFileSync(join(root, path), 'utf8') !== text;
    } catch {
      return true;
    }
  });
  const leftOver = readdirSync(join(root, MESSAGES_DIRECTORY), { withFileTypes: true })
    .map((entry) => `${MESSAGES_DIRECTORY}/${entry.name}`)
    .filter((path) => !files.has(path));
  return [...stale.map(([path]) => path), ...leftOver];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = process.cwd();
  if (process.argv.includes('--check')) {
    const stale = stalePages(root);
    if (stale.length) throw new Error(`message pages out of date: ${stale.join(', ')}`);
  } else {
    rmSync(join(root, MESSAGES_DIRECTORY), { recursive: true, force: true });
    mkdirSync(join(root, MESSAGES_DIRECTORY), { recursive: true });
    for (const [path, text] of messagePages()) writeFileSync(join(root, path), text);
  }
}
