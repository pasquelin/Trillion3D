import french from '../reference/api.fr.json' with { type: 'json' };
import { REFERENCE } from '../entries/reference.ts';
import type { EntryOverlay, LocaleOverlay } from './entryOverlay.ts';

/** One generated entry in French: its lines, each parameter and member by its name. */
export interface ReferenceFrench {
  summary: string;
  description?: string;
  parameters?: Record<string, string>;
  returns?: string;
  members?: Record<string, string>;
  values?: Record<string, string>;
}

/** The name a row is keyed by in `api.fr.json`: `options.renderer`, `add`, without type or `?`. */
export const rowKey = (name: string) => name.replace(/[?(].*$/, '');

const table = french as Record<string, ReferenceFrench>;

/** The French overlay of the generated reference: each row keeps its name and type, and takes the
 *  French text of its meaning when `api.fr.json` has one. */
export const referenceFr: LocaleOverlay = Object.fromEntries(
  REFERENCE.filter((entry) => table[entry.id]).map((entry) => {
    const text = table[entry.id];
    const overlay: EntryOverlay = { summary: text.summary };
    if (text.description) overlay.description = text.description;
    if (entry.parameters)
      overlay.parameters = entry.parameters.map((row) => ({
        ...row,
        desc: text.parameters?.[rowKey(row.name)] ?? row.desc,
      }));
    if (entry.returns)
      overlay.returns = { ...entry.returns, desc: text.returns ?? entry.returns.desc };
    if (entry.members)
      overlay.members = entry.members.map((row) => ({
        ...row,
        desc: text.members?.[rowKey(row.name)] ?? row.desc,
      }));
    if (entry.values && text.values)
      overlay.values = entry.values.map(({ name }) => ({ desc: text.values?.[name] }));
    return [entry.id, overlay];
  }),
);
