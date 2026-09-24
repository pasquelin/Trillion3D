import ts from 'typescript';
import type { PortalEntry } from '../../site/content/model.ts';
import { apiProgram, entryModules, PUBLIC_ENTRIES, type ExportEntry } from '../sdk-api-model.ts';
import { Shapes } from './collect.ts';
import { documented } from './documented.ts';
import { sectionOf } from './sections.ts';

/** Types whose members a page reaches through one object, and the name it reaches them by. */
const INSTANCE_MEMBERS: Record<string, string> = { World: 'world' };
/** The world is not an export of its own: its members name `createWorld`, which returns it. */
const OWNER_EXPORT: Record<string, string> = { world: 'createWorld' };
/** A type alias longer than this is shown by name; its members say the rest. */
const ALIAS_TEXT_LIMIT = 240;

const heritageOf = (node: ts.Node | undefined) =>
  node && (ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node))
    ? (node.heritageClauses ?? []).map((clause) => ` ${clause.getText()}`).join('')
    : '';

class ReferenceWalk {
  readonly entries: PortalEntry[] = [];
  private readonly shapes: Shapes;
  private readonly families: ReadonlySet<string>;
  constructor(shapes: Shapes, families: ReadonlySet<string>) {
    this.shapes = shapes;
    this.families = families;
  }

  /** Every member of a family object, or of the world, as an entry of its own. */
  private memberEntries(
    prefix: string,
    base: Pick<PortalEntry, 'section' | 'module'>,
    type: ts.Type,
    owner: ts.Symbol,
  ) {
    const { shapes } = this;
    for (const member of shapes.members(type, null)) {
      const memberType = shapes.typeOf(member);
      const node = shapes.declarationOf(member);
      const id = `${prefix}.${member.name}`;
      const calls = shapes.calls(id, memberType);
      const nested = calls.length ? [] : shapes.inlineMembers(memberType);
      const fields = {
        ...base,
        id,
        kind: calls.length ? 'Function' : 'Constant',
        title: calls.length ? `${id}()` : id,
        exports: [OWNER_EXPORT[prefix] ?? prefix],
        signature: calls.join('\n') || `${id}: ${shapes.text(memberType, node, false)}`,
        members: nested.map((row) => shapes.row(row, member)),
      };
      const doc = shapes.doc(member, owner);
      this.entries.push(documented(shapes, fields, doc, memberType.getCallSignatures()[0]));
    }
  }

  add(name: string, id: string, symbol: ts.Symbol): void {
    const { shapes } = this;
    const { checker } = shapes;
    const node = shapes.declarationOf(symbol);
    const module = shapes.moduleOf(symbol);
    const base = { id, module, exports: [name], section: sectionOf(module, this.families) };
    // The engine contract a page word shadows reads apart, and leads to its own page.
    const title = id === name ? name : `${name} (engine contract)`;
    const doc = shapes.doc(symbol);
    const entry = (
      fields: Omit<PortalEntry, 'description' | keyof typeof base>,
      signature?: ts.Signature,
    ) => this.entries.push(documented(shapes, { ...base, ...fields }, doc, signature));
    if (symbol.flags & ts.SymbolFlags.Class) {
      const statics = shapes.typeOf(symbol);
      const constructs = statics.getConstructSignatures();
      const rows = [
        ...shapes.members(checker.getDeclaredTypeOfSymbol(symbol), symbol),
        ...shapes.members(statics, symbol).filter((member) => member.name !== 'prototype'),
      ];
      const creation = constructs.map((signature) => shapes.call(`new ${name}`, signature));
      entry(
        {
          kind: 'Type',
          title,
          signature: [`class ${name}${heritageOf(node)}`, ...creation].join('\n'),
          members: rows.map((row) => shapes.row(row, symbol)),
        },
        constructs[0],
      );
      return;
    }
    if (symbol.flags & (ts.SymbolFlags.Function | ts.SymbolFlags.Variable)) {
      const type = shapes.typeOf(symbol);
      const calls = shapes.calls(name, type);
      if (calls.length) {
        const first = type.getCallSignatures()[0];
        return void entry(
          { kind: 'Function', title: `${name}()`, signature: calls.join('\n') },
          first,
        );
      }
      const family = this.families.has(name) && module.includes('/world/');
      const rows = family ? [] : shapes.inlineMembers(type).map((row) => shapes.row(row, symbol));
      const shape = rows.length || family ? '' : `: ${shapes.text(type, node, false)}`;
      entry({ kind: 'Constant', title, signature: `const ${name}${shape}`, members: rows });
      if (family) this.memberEntries(name, base, type, symbol);
      return;
    }
    const type = checker.getDeclaredTypeOfSymbol(symbol);
    const alias = node && ts.isTypeAliasDeclaration(node) ? node.type.getText() : '';
    const signature = ts.isInterfaceDeclaration(node ?? symbol.declarations![0])
      ? `interface ${name}${heritageOf(node)}`
      : `type ${name}${alias && alias.length <= ALIAS_TEXT_LIMIT ? ` = ${alias}` : ''}`;
    const prefix = INSTANCE_MEMBERS[name];
    // An alias of a named class or interface shows none: its members stay with the type it names.
    const own = alias ? shapes.inlineMembers(type) : shapes.members(type, symbol);
    const rows = prefix ? [] : own.map((row) => shapes.row(row, symbol));
    entry({ kind: 'Type', title, signature, members: rows });
    if (prefix) this.memberEntries(prefix, base, type, symbol);
  }
}

/**
 * The reference of the three public entries (common, browser, Node): one entry per export, and
 * one per member of a world family and of the world. A name the browser entry binds to another
 * symbol than the common one (a page word shadowing an engine contract) keeps its name there;
 * the common binding is listed as `<name>-common`.
 */
export function buildReference(families: ReadonlySet<string>): PortalEntry[] {
  const program = apiProgram(PUBLIC_ENTRIES);
  const shapes = new Shapes(program.getTypeChecker());
  const bindings = new Map<string, { symbol: ts.Symbol; entries: ExportEntry[] }[]>();
  for (const [entry, module] of entryModules(program, PUBLIC_ENTRIES))
    for (const exported of shapes.checker.getExportsOfModule(module)) {
      const symbol =
        exported.flags & ts.SymbolFlags.Alias
          ? shapes.checker.getAliasedSymbol(exported)
          : exported;
      const list = bindings.get(exported.name) ?? [];
      const known = list.find((binding) => binding.symbol === symbol);
      if (known) known.entries.push(entry);
      else list.push({ symbol, entries: [entry] });
      bindings.set(exported.name, list);
    }
  // An anonymous object an export aliases reads by that alias wherever it appears.
  for (const list of bindings.values())
    for (const { symbol } of list) {
      const node = symbol.declarations?.[0];
      const type =
        node && ts.isTypeAliasDeclaration(node) && shapes.checker.getDeclaredTypeOfSymbol(symbol);
      if (type && type.flags & ts.TypeFlags.Object && !type.aliasSymbol?.declarations?.length)
        shapes.names.set(type, symbol.name);
    }
  const walk = new ReferenceWalk(shapes, families);
  for (const [name, list] of [...bindings].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
    for (const { symbol, entries } of list)
      walk.add(
        name,
        list.length > 1 && !entries.includes('browser') ? `${name}-common` : name,
        symbol,
      );
  return walk.entries;
}
