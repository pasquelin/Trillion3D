import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';
import english from '../i18n/en.json' with { type: 'json' };
import { announce } from './banner.ts';
import { overlay } from './overlay.ts';
import { useWords } from './words.ts';

test('every example gives the banner a line of what to do', () => {
  const words = english as Record<string, { banner?: unknown }>;
  const examplesDir = new URL('..', import.meta.url);
  const silent = readdirSync(examplesDir)
    .filter((name) => name.endsWith('.html'))
    .map((name) => name.slice(0, -'.html'.length))
    // An example that never loads the kit draws no banner, and carries none.
    .filter((id) =>
      readFileSync(new URL(`${id}.html`, examplesDir), 'utf8').includes('runtime/kit.js'),
    )
    .filter((id) => typeof words[id]?.banner !== 'string' || !words[id].banner);
  assert.deepEqual(silent, []);
});

/** Just enough of an element for the kit's overlay and its banner. */
class Element {
  children: Element[] = [];
  parent?: Element;
  hidden = false;
  textContent = '';
  dataset = {};
  style = {};
  click = () => {};
  readonly tag: string;
  constructor(tag: string) {
    this.tag = tag;
  }
  append(...children: Element[]) {
    for (const child of children) {
      child.remove();
      child.parent = this;
      this.children.push(child);
    }
  }
  remove() {
    this.parent?.children.splice(this.parent.children.indexOf(this), 1);
    this.parent = undefined;
  }
  get isConnected() {
    return this.parent !== undefined;
  }
  attachShadow() {
    return new Element('shadow');
  }
  addEventListener(type: string, listener: () => void) {
    if (type === 'click') this.click = listener;
  }
  removeAttribute() {}
}

test('the banner says the latest news over the example, until the reader closes it', () => {
  const location = { search: '' };
  const body = new Element('body');
  Object.assign(globalThis, {
    document: { location, body, createElement: (tag: string) => new Element(tag) },
  });
  // `document.baseURI` is absent on the fake document, so the example's id falls back to
  // `about:blank`'s `blank`.
  useWords({ blank: { banner: 'What to do' } }, 'en');
  try {
    const layer = overlay() as unknown as Element;
    const shown = () => {
      const card = layer.children.find(({ tag }) => tag === 'div');
      const [words] = card?.children ?? [];
      return words?.children.filter(({ hidden }) => !hidden).map(({ textContent }) => textContent);
    };
    // Start: the example's line of what to do, without a title.
    announce('');
    assert.deepEqual(shown(), ['What to do']);
    // A return to that line changes nothing while it's already there.
    announce('');
    assert.deepEqual(shown(), ['What to do']);
    announce('Checkpoint', 'Keep going');
    assert.deepEqual(shown(), ['Checkpoint', 'Keep going']);
    announce('', 'Listening');
    assert.deepEqual(shown(), ['Listening']);
    layer.children[0].children[1].click();
    assert.equal(shown(), undefined);
    // A repeat of the same announcement does not reopen a closed banner.
    announce('', 'Listening');
    assert.equal(shown(), undefined, 'a repeat does not reopen a closed banner');
    // Closed, a return to the line of what to do leaves it closed.
    announce('');
    assert.equal(shown(), undefined, 'a return to the line of what to do leaves it closed');
    // Closed, a real announcement (a title, here) reopens it.
    announce('Finished', '12 s');
    assert.deepEqual(shown(), ['Finished', '12 s'], 'a real announcement reopens a closed banner');
    layer.children[0].children[1].click();
    location.search = '?capture';
    announce('Checkpoint');
    assert.equal(shown(), undefined, 'a capture never shows it, not even to reopen it');
  } finally {
    Reflect.deleteProperty(globalThis, 'document');
  }
});
