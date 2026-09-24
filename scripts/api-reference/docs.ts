import ts from 'typescript';
import { ENGINE_ERROR_CODES } from '../../packages/sdk-core/src/contracts/errorCodes.ts';

/** What the TSDoc of one symbol says: its text, `@param` lines, `@returns`, `@defaultValue` and
 *  `@example`. */
export interface SymbolDoc {
  text: string;
  params: Map<string, string>;
  returns?: string;
  defaultValue?: string;
  example?: string;
  /** `@errorCodes`: each code the engine's error may carry, with what it means. */
  codes?: [string, string][];
}

const aliased = (symbol: ts.Symbol, checker: ts.TypeChecker) =>
  symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;

/**
 * The symbols a member may read its documentation from: itself, then the declaration a shorthand
 * (`{ box }`) or an identifier initializer (`{ box: makeBox }`) names — a family member is most
 * often documented where its function is written, not in the family object.
 */
function sources(symbol: ts.Symbol, checker: ts.TypeChecker): ts.Symbol[] {
  const found = [symbol];
  const declaration = symbol.valueDeclaration;
  if (declaration && ts.isShorthandPropertyAssignment(declaration)) {
    const value = checker.getShorthandAssignmentValueSymbol(declaration);
    if (value) found.push(aliased(value, checker));
  } else if (
    declaration &&
    ts.isPropertyAssignment(declaration) &&
    (ts.isIdentifier(declaration.initializer) ||
      ts.isPropertyAccessExpression(declaration.initializer))
  ) {
    const value = checker.getSymbolAtLocation(declaration.initializer);
    if (value) found.push(aliased(value, checker));
  }
  return found;
}

function tagText(tag: ts.JSDocTagInfo): string {
  return ts.displayPartsToString(tag.text).trim();
}

function parameterOf(tag: ts.JSDocTagInfo): [string, string] | null {
  const name = tag.text?.find((part) => part.kind === 'parameterName')?.text;
  if (!name) return null;
  const rest = (tag.text ?? [])
    .filter((part) => part.kind !== 'parameterName')
    .map((part) => part.text)
    .join('')
    .replace(/^\s*-?\s*/, '')
    .trim();
  return [name, rest];
}

/**
 * A member with no comment of its own — built from a list of keys (`{ [Name in Curve]: Name }`),
 * or written on one line with its siblings — is documented by its owner's
 * `@property <name> - <text>` line.
 */
function ownerLine(symbol: ts.Symbol, owner: ts.Symbol, checker: ts.TypeChecker): string {
  const prefix = `${symbol.name} - `;
  const line = owner
    .getJsDocTags(checker)
    .filter((tag) => tag.name === 'property')
    .map(tagText)
    .find((text) => text.startsWith(prefix));
  return line ? line.slice(prefix.length).trim() : '';
}

/** The `@param` lines of `source`, by parameter name. */
function paramsOf(source: ts.Symbol, checker: ts.TypeChecker): [string, string][] {
  return source
    .getJsDocTags(checker)
    .filter((tag) => tag.name === 'param')
    .map(parameterOf)
    .filter((pair): pair is [string, string] => pair !== null && pair[1] !== '');
}

/**
 * The documentation of `symbol`, read from the first of its sources that carries any; its
 * parameters from every source, the nearest first (a family member names what the function
 * it points at does not).
 */
export function readDoc(symbol: ts.Symbol, checker: ts.TypeChecker, owner?: ts.Symbol): SymbolDoc {
  const found = sources(symbol, checker);
  const params = new Map(found.flatMap((source) => paramsOf(source, checker)).reverse());
  const tags = found.flatMap((source) => source.getJsDocTags(checker));
  const tag = (name: string) => {
    const match = tags.find((candidate) => candidate.name === name);
    return match && tagText(match);
  };
  const codes = tags.some((candidate) => candidate.name === 'errorCodes')
    ? ENGINE_ERROR_CODES.flatMap(([names, meaning]) =>
        names.map((code): [string, string] => [code, meaning]),
      )
    : [];
  const text = found
    .map((source) => ts.displayPartsToString(source.getDocumentationComment(checker)).trim())
    .find(Boolean);
  return {
    text: text?.replace(/\s*\n\s*/g, ' ') ?? (owner ? ownerLine(symbol, owner, checker) : ''),
    params,
    ...(codes.length ? { codes } : {}),
    returns: tag('returns'),
    defaultValue: tag('defaultValue'),
    example: tag('example')
      ?.replace(/^```\w*\n?|\n?```$/g, '')
      .trim(),
  };
}
