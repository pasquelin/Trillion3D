// The CSS selectors the examples' kit finds its own elements with, on the bench's fake elements:
// a tag, `#id`, `.class` and `[attr]` / `[attr="value"]` parts, joined, in comma lists, with
// descendants (`a b`). Enough for a page's own panels; anything else matches nothing.

/** What a selector reads of an element. */
export type Matchable = {
  tagName: string;
  id: string;
  className?: string;
  classList: { has(name: string): boolean };
  dataset: Record<string, string>;
  attributes: Map<string, string>;
  children: Matchable[];
  parentElement: Matchable | null;
};

type Part = { tag?: string; id?: string; classes: string[]; attrs: [string, string | undefined][] };

const camel = (name: string) => name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

/** One compound selector (`div.row[data-sec="gpu"]`), parsed. */
function parsePart(text: string): Part {
  const part: Part = { classes: [], attrs: [] };
  for (const [token] of text.matchAll(/[#.]?[\w-]+|\[[^\]]+\]/g)) {
    if (token.startsWith('#')) part.id = token.slice(1);
    else if (token.startsWith('.')) part.classes.push(token.slice(1));
    else if (token.startsWith('[')) {
      const [, name, value] =
        /^\[\s*([\w-]+)\s*(?:=\s*["']?([^"'\]]*)["']?)?\s*\]$/.exec(token) ?? [];
      if (name) part.attrs.push([name, value]);
    } else part.tag = token.toUpperCase();
  }
  return part;
}

/** An element's attribute as the DOM reads it: its own, its dataset's, its id or class. */
function attribute(element: Matchable, name: string) {
  if (element.attributes.has(name)) return element.attributes.get(name);
  if (name.startsWith('data-')) return element.dataset[camel(name.slice(5))];
  if (name === 'id') return element.id || undefined;
  if (name === 'class') return element.className || undefined;
  return undefined;
}

function matchesPart(element: Matchable, part: Part) {
  if (part.tag && element.tagName !== part.tag) return false;
  if (part.id && element.id !== part.id) return false;
  if (part.classes.some((name) => !element.classList.has(name))) return false;
  return part.attrs.every(([name, value]) => {
    const found = attribute(element, name);
    return value === undefined ? found !== undefined : found === value;
  });
}

/** Whether `element` matches `selector`: one of its comma alternatives, read right to left over
 *  its ancestors. */
export function matches(element: Matchable, selector: string): boolean {
  return selector.split(',').some((alternative) => {
    const parts = alternative.trim().split(/\s+/).map(parsePart);
    if (!matchesPart(element, parts.at(-1)!)) return false;
    let at = element.parentElement;
    for (let i = parts.length - 2; i >= 0; i--) {
      while (at && !matchesPart(at, parts[i])) at = at.parentElement;
      if (!at) return false;
      at = at.parentElement;
    }
    return true;
  });
}

/** The descendants of `root` that match `selector`, in document order. */
export function selectAll<T extends Matchable>(root: T, selector: string): T[] {
  const found: T[] = [];
  const walk = (node: Matchable) => {
    for (const child of node.children) {
      if (matches(child, selector)) found.push(child as T);
      walk(child);
    }
  };
  walk(root);
  return found;
}
