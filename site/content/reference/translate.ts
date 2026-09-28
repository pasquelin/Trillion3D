import type { PortalEntry } from '../model.ts';

/** One generated entry in another language: its lines, and each row's meaning by its name. */
export interface ReferenceText {
  summary?: string;
  description?: string;
  valuesTitle?: string;
  returns?: string;
  parameters?: Record<string, string>;
  members?: Record<string, string>;
  values?: Record<string, string>;
}

/** The fields a written note may take over from the generated entry, in `site/i18n/`. */
interface WrittenFields {
  description?: string;
  values?: unknown;
}

/** The name a row is keyed by in a translation: `options.renderer`, `add`, without type or `?`. */
const rowKey = (name: string) => name.replace(/[?(].*$/, '');

const LINES = ['summary', 'description', 'valuesTitle'] as const;
const ROWS = ['parameters', 'members', 'values'] as const;

/** The keys a translation of `entry` gives, `summary` to `values.<name>`, each with its English:
 *  every English text of the generated entry that no written note replaces. */
export function referenceTexts(
  entry: PortalEntry,
  written: WrittenFields = {},
): [string, string][] {
  const lines = LINES.flatMap((field): [string, string][] => {
    const text = entry[field];
    return text && !written[field as keyof WrittenFields] ? [[field, text]] : [];
  });
  const rows = ROWS.flatMap((field) =>
    field === 'values' && written.values
      ? []
      : (entry[field] ?? [])
          .filter(({ desc }) => desc)
          .map(({ name, desc }): [string, string] => [`${field}.${rowKey(name)}`, desc]),
  );
  const returns = entry.returns?.desc;
  return [...lines, ...(returns ? [['returns', returns] as [string, string]] : []), ...rows];
}

/** The keys a translation of `entry` gives, in `referenceTexts`'s order. */
export const referenceKeys = (entry: PortalEntry, written?: WrittenFields) =>
  referenceTexts(entry, written).map(([key]) => key);

const translateRows = <Row extends { name: string; desc: string }>(
  rows: Row[],
  table: Record<string, string> | undefined,
) => rows.map((row) => ({ ...row, desc: table?.[rowKey(row.name)] ?? row.desc }));

/** `entry` with the text of `text` in place of its English, row by row. */
export function translateReference(entry: PortalEntry, text: ReferenceText | undefined) {
  if (!text) return entry;
  const result: PortalEntry = { ...entry };
  for (const field of LINES) if (text[field]) result[field] = text[field];
  if (entry.returns && text.returns) result.returns = { ...entry.returns, desc: text.returns };
  if (entry.parameters) result.parameters = translateRows(entry.parameters, text.parameters);
  if (entry.members) result.members = translateRows(entry.members, text.members);
  if (entry.values) result.values = translateRows(entry.values, text.values);
  return result;
}
