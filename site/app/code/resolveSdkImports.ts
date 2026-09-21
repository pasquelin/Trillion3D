import { javascriptLanguage } from '@codemirror/lang-javascript';

/** Resolve literal SDK module specifiers without changing ordinary source strings. */
export function resolveSdkImports(code: string, sdkUrl: string) {
  const replacements: { from: number; to: number }[] = [];
  javascriptLanguage.parser.parse(code).iterate({
    enter(node) {
      if (node.name !== 'String') return;
      const parent = node.node.parent?.name;
      let previous = node.node.prevSibling;
      while (previous && ['BlockComment', 'LineComment'].includes(previous.name))
        previous = previous.prevSibling;
      const token = previous?.name;
      const isSource =
        (parent === 'ImportDeclaration' &&
          token !== undefined &&
          ['import', 'from'].includes(token)) ||
        (parent === 'ExportDeclaration' && token === 'from') ||
        (parent === 'DynamicImport' && token === '(');
      if (!isSource) return;
      const literal = code.slice(node.from, node.to);
      if (literal !== "'./js/engine.js'" && literal !== '"./js/engine.js"') return;
      replacements.push({ from: node.from, to: node.to });
    },
  });
  for (const { from, to } of replacements.reverse())
    code = code.slice(0, from) + JSON.stringify(sdkUrl) + code.slice(to);
  return code;
}
