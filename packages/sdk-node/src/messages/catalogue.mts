import { readFileSync } from 'node:fs';

/** How much a message weighs: an error publishes nothing, a warning is always told, an info only on request. */
export type MessageLevel = 'error' | 'warn' | 'info';

/** One entry of the public message catalogue. */
export interface CatalogueMessage {
  /** The stable public code: `T3D-Exxx`, `T3D-Wxxx` or `T3D-Ixxx`. */ id: string;
  /** The symbolic name the compiler writes (`DAG_FLAT`, `blend-truncated`). */ code: string;
  /** Its level. */ level: MessageLevel;
  /** The documentation section it belongs to. */ group: string;
  /** What happened, in one sentence. */ message: string;
  /** Why it happens. */ cause: string;
  /** What the user does about it. */ action: string;
}

/**
 * The catalogue beside this module, which the compiler embeds too: one source of truth for the
 * compiler, this adapter and the documentation. The build copies it beside the built module.
 */
const CATALOGUE = JSON.parse(readFileSync(new URL('./messages.json', import.meta.url), 'utf8')) as {
  docs: string;
  messages: CatalogueMessage[];
};
const BY_CODE = new Map(CATALOGUE.messages.map((entry) => [entry.code, entry]));

/** Every catalogue entry, in id order within each level. */
export const catalogueMessages: readonly CatalogueMessage[] = CATALOGUE.messages;

/** The entry of a symbolic code; a code with a detail after `:` is its name's entry. */
export const messageOf = (code: string) => BY_CODE.get(code.split(':')[0]);

/** The documentation page of an entry. */
export const docsOf = (entry: CatalogueMessage) => `${CATALOGUE.docs}${entry.id}.md`;

/** The line a person reads: public code, name, sentence, detail, action and documentation page. */
export function describeMessage(code: string, detail?: string) {
  const entry = messageOf(code);
  if (!entry) return detail ? `${code}: ${detail}` : code;
  const extra = detail ? ` (${detail})` : '';
  return `${entry.id} ${code}: ${entry.message}${extra} ${entry.action} ${docsOf(entry)}`;
}

/** A failure of the compiler or of this adapter, carrying its catalogue code. */
class CompilerMessageError extends Error {
  /** The public code, when the catalogue knows the name. */ readonly id?: string;
  /** The symbolic name. */ readonly code: string;
  constructor(code: string, detail?: string, options?: ErrorOptions) {
    super(describeMessage(code, detail), options);
    this.code = code;
    this.id = messageOf(code)?.id;
  }
}

/** The error of a catalogue code, with an optional detail (a path, a count, the compiler's text). */
export const compilerError = (code: string, detail?: string, options?: ErrorOptions) =>
  new CompilerMessageError(code, detail, options);
