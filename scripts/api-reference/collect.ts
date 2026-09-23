import { relative } from 'node:path';
import ts from 'typescript';
import type { PortalMember, PortalParameter } from '../../site/content/model.ts';
import { ROOT } from '../sdk-api-model.ts';
import { readDoc, type SymbolDoc } from './docs.ts';

const FORMAT =
  ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseSingleQuotesForStringLiteralType;
/** An options object a function takes is listed field by field: `options.renderer`, … */
const OPTIONS_TYPE = /(?:Options|Parameters)$/;

/** Whether a member is part of the public shape: declared in the packages, not private. */
function isPublicMember(member: ts.Symbol, owner: ts.Symbol | null): boolean {
  if (/^[#_]/.test(member.name)) return false;
  const declared = !owner || !(owner.flags & (ts.SymbolFlags.Class | ts.SymbolFlags.Interface));
  // A mapped type's keys (`{ [Name in Curve]: Name }`) have no declaration of their own.
  if (!member.declarations?.length) return declared;
  return member.declarations.some((declaration) => {
    if (!declaration.getSourceFile().fileName.includes('/packages/')) return false;
    const modifiers = ts.getCombinedModifierFlags(declaration);
    if (modifiers & (ts.ModifierFlags.Private | ts.ModifierFlags.Protected)) return false;
    // A class or an interface lists what it declares itself: inherited members stay with the base.
    return declared || (owner.declarations ?? []).includes(declaration.parent as ts.Declaration);
  });
}

/** Reads shapes and TSDoc through one type checker, and turns them into portal rows. */
export class Shapes {
  readonly checker: ts.TypeChecker;
  /** The public name of an anonymous type an export aliases (`World` for what `createWorld`
   *  returns), filled by the walk before any entry is written. */
  readonly names = new Map<ts.Type, string>();
  constructor(checker: ts.TypeChecker) {
    this.checker = checker;
  }

  declarationOf(symbol: ts.Symbol): ts.Declaration | undefined {
    return symbol.valueDeclaration ?? symbol.declarations?.[0];
  }

  moduleOf(symbol: ts.Symbol): string {
    return relative(ROOT, this.declarationOf(symbol)?.getSourceFile().fileName ?? '');
  }

  typeOf(symbol: ts.Symbol): ts.Type {
    return symbol.flags & ts.SymbolFlags.Value
      ? this.checker.getTypeOfSymbol(symbol)
      : this.checker.getDeclaredTypeOfSymbol(symbol);
  }

  /** A type as a reader sees it: by the public name it is exported under, else spelt out (in
   *  full, or shortened when `full` is false), never through a file path. */
  text(type: ts.Type, node?: ts.Node, full = true): string {
    const named = this.names.get(type);
    if (named) return named;
    const flags = full ? FORMAT : ts.TypeFormatFlags.UseSingleQuotesForStringLiteralType;
    return this.checker
      .typeToString(type, node, flags)
      .replace(/import\("[^"]*(?:"\)\.|\.\.\.$)/g, (path) => (path.endsWith('...') ? '...' : ''));
  }

  /** `name(a: A, b?: B): R`, spelt with the names `text` gives the types. */
  call(name: string, signature: ts.Signature): string {
    const node = signature.declaration;
    const parameters = signature.getParameters().map((parameter) => {
      const declaration = parameter.valueDeclaration as ts.ParameterDeclaration | undefined;
      const optional = declaration?.questionToken || declaration?.initializer ? '?' : '';
      const rest = declaration?.dotDotDotToken ? '...' : '';
      const type = this.checker.getTypeOfSymbolAtLocation(parameter, declaration ?? node!);
      const shown = optional ? this.checker.getNonNullableType(type) : type;
      return `${rest}${parameter.name}${optional}: ${this.text(shown, declaration, false)}`;
    });
    return `${name}(${parameters.join(', ')}): ${this.text(signature.getReturnType(), node, false)}`;
  }

  /** Every overload of a callable, one line each. */
  calls(name: string, type: ts.Type): string[] {
    return type.getCallSignatures().map((signature) => this.call(name, signature));
  }

  /** The public members of a type: what `owner` declares itself, when it is a class or an interface. */
  members(type: ts.Type, owner: ts.Symbol | null): ts.Symbol[] {
    if (type.getCallSignatures().length || this.checker.isArrayLikeType(type)) return [];
    if (!(type.flags & ts.TypeFlags.Object) && !type.isIntersection()) return [];
    return this.checker.getPropertiesOfType(type).filter((member) => isPublicMember(member, owner));
  }

  /** The members an object shows in place: those of an unnamed shape, never of a named type. */
  inlineMembers(type: ts.Type): ts.Symbol[] {
    const named = type.getSymbol()?.flags ?? 0;
    return named & (ts.SymbolFlags.Class | ts.SymbolFlags.Interface)
      ? []
      : this.members(type, null);
  }

  /** One member as a row: a field and its type, or a method and what it returns. */
  row(member: ts.Symbol, owner?: ts.Symbol): PortalMember {
    const type = this.typeOf(member);
    const node = this.declarationOf(member);
    const desc = readDoc(member, this.checker, owner).text;
    const signature = member.flags & ts.SymbolFlags.Method ? type.getCallSignatures()[0] : null;
    if (signature) {
      const returns = this.text(signature.getReturnType(), node, false);
      const call = this.call(member.name, signature);
      return { name: call.slice(0, call.length - returns.length - 2), type: returns, desc };
    }
    const optional = member.flags & ts.SymbolFlags.Optional ? '?' : '';
    return { name: `${member.name}${optional}`, type: this.text(type, node, false), desc };
  }

  /** The parameters of a call, an options object spread field by field after its own row. */
  parameters(signature: ts.Signature, doc: SymbolDoc): PortalParameter[] {
    return signature.getParameters().flatMap((parameter) => {
      const node = parameter.valueDeclaration as ts.ParameterDeclaration | undefined;
      const name = node && !ts.isIdentifier(node.name) ? node.name.getText() : parameter.name;
      const type = this.checker.getTypeOfSymbolAtLocation(
        parameter,
        node ?? signature.declaration!,
      );
      const optional = Boolean(node?.questionToken);
      const own: PortalParameter = {
        name: `${name}${optional ? '?' : ''}`,
        type: this.text(optional ? this.checker.getNonNullableType(type) : type, node, false),
        ...(node?.initializer ? { default: node.initializer.getText() } : {}),
        desc: doc.params.get(name) ?? '',
      };
      const options = this.checker.getNonNullableType(type);
      const named = options.aliasSymbol ?? options.getSymbol();
      if (!named || !OPTIONS_TYPE.test(named.name)) return [own];
      own.desc ||= readDoc(named, this.checker).text;
      const fields = this.members(options, null).map((field): PortalParameter => {
        const fieldDoc = readDoc(field, this.checker);
        const optionalField = field.flags & ts.SymbolFlags.Optional ? '?' : '';
        return {
          name: `${name}.${field.name}${optionalField}`,
          type: this.text(this.checker.getNonNullableType(this.typeOf(field)), node, false),
          ...(fieldDoc.defaultValue ? { default: fieldDoc.defaultValue } : {}),
          desc: fieldDoc.text,
        };
      });
      return [own, ...fields];
    });
  }

  doc(symbol: ts.Symbol, owner?: ts.Symbol): SymbolDoc {
    return readDoc(symbol, this.checker, owner);
  }
}
