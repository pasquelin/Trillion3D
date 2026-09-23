import type ts from 'typescript';
import { entrySummary, type PortalEntry } from '../../site/content/model.ts';
import type { Shapes } from './collect.ts';
import type { SymbolDoc } from './docs.ts';

/**
 * An entry filled from TSDoc, in the order a page reads it: the summary line, the parameters and
 * return of `signature`, the `@example`, the members, and the longer text after the summary.
 */
export function documented(
  shapes: Shapes,
  entry: Omit<PortalEntry, 'description'>,
  doc: SymbolDoc,
  signature?: ts.Signature,
): PortalEntry {
  const summary = entrySummary({ description: doc.text });
  const returned = signature?.getReturnType();
  const said = returned ? shapes.text(returned, signature?.declaration, false) : 'void';
  const parameters = signature ? shapes.parameters(signature, doc) : [];
  const { members, ...fields } = entry;
  return {
    ...fields,
    summary,
    ...(parameters.length ? { parameters } : {}),
    ...(said !== 'void' && entry.kind !== 'Type'
      ? { returns: { type: said, desc: doc.returns ?? '' } }
      : {}),
    ...(doc.example ? { example: doc.example } : {}),
    ...(members?.length ? { members } : {}),
    ...(doc.codes
      ? { valuesTitle: 'Error codes', values: doc.codes.map(([name, desc]) => ({ name, desc })) }
      : {}),
    description: doc.text.slice(summary.length).trim(),
  };
}
