import { javascriptLanguage } from '@codemirror/lang-javascript';

/** Resolve literal SDK module specifiers without changing ordinary source strings. */
export function resolveSdkImports(code, sdkUrl) {
  const replacements = [];
  javascriptLanguage.parser.parse(code).iterate({
    enter(node) {
      if (node.name !== 'String') return;
      const parent = node.node.parent?.name;
      if (!['ImportDeclaration', 'ExportDeclaration', 'DynamicImport'].includes(parent)) return;
      const literal = code.slice(node.from, node.to);
      if (literal !== "'./js/engine.js'" && literal !== '"./js/engine.js"') return;
      replacements.push({ from: node.from, to: node.to });
    },
  });
  for (const { from, to } of replacements.reverse())
    code = code.slice(0, from) + JSON.stringify(sdkUrl) + code.slice(to);
  return code;
}
