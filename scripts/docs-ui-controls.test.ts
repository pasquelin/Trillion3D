import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import type { ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadReactComponents } from './docs/render-react.ts';
import type { Tree as TreeComponent } from '../site/app/ui/Tree.tsx';

const { Dropdown } = (await loadReactComponents('site/app/ui/Dropdown.tsx')) as {
  Dropdown: ComponentType<Record<string, unknown>>;
};
const { Tree: GenericTree } = (await loadReactComponents('site/app/ui/Tree.tsx')) as {
  Tree: typeof TreeComponent;
};
const { NumberField, TextField } = (await loadReactComponents('site/app/ui/NumberField.tsx')) as {
  NumberField: ComponentType<Record<string, unknown>>;
  TextField: ComponentType<Record<string, unknown>>;
};

interface Node {
  name: string;
  visible: boolean;
  children: Node[];
}
// An instantiation expression gives `createElement` the generic tree's type parameter.
const Tree = GenericTree<Node>;
const noop = () => {};

test('a dropdown starts closed, its disabled item disabled and its chosen item pressed', () => {
  const html = renderToStaticMarkup(
    createElement(Dropdown, {
      label: 'Edit',
      items: [
        { key: 'undo', label: 'Undo', onSelect: noop, disabled: true },
        { key: 'redo', label: 'Redo', onSelect: noop, pressed: true },
      ],
    }),
  );
  assert.match(html, /^<details class="dropdown ">/);
  assert.match(html, /<summary[^>]*>Edit<\/summary>/);
  assert.match(html, /<li class="menu-disabled [^"]*"><button type="button" disabled="">Undo/);
  assert.match(html, /<button type="button" aria-pressed="true">Redo/);
});

test('a tree nests its rows, marks the selected one and dims a hidden one', () => {
  const leaf: Node = { name: 'leaf', visible: false, children: [] };
  const root: Node = { name: 'root', visible: true, children: [leaf] };
  const html = renderToStaticMarkup(
    createElement(Tree, {
      nodes: [root],
      keyOf: (node) => node.name,
      labelOf: (node) => node.name,
      nameOf: (node) => node.name,
      childrenOf: (node) => node.children,
      visibleOf: (node) => node.visible,
      selected: leaf,
      onSelect: noop,
      onRename: noop,
      onVisible: noop,
      onMove: noop,
      labels: { rename: 'Rename', show: 'Show', hide: 'Hide' },
    }),
  );
  assert.match(html, /root<\/button>.*<ul class="pl-3"><li>.*leaf<\/button>/);
  assert.match(html, /opacity-50" aria-current="true" title="leaf"/);
  assert.match(html, /aria-pressed="true" aria-label="Hide"/);
  assert.match(html, /aria-pressed="false" aria-label="Show"/);
});

test('a number field shows three decimals at most, a text field its value', () => {
  const number = renderToStaticMarkup(
    createElement(NumberField, { label: 'Width', value: 1 / 3, onCommit: noop }),
  );
  assert.match(number, /value="0.333"/);
  assert.match(number, /<span class="label [^"]*truncate" title="Width">Width<\/span>/);
  const text = renderToStaticMarkup(
    createElement(TextField, { label: 'Name', value: 'Box', onCommit: noop }),
  );
  assert.match(text, /title="Name">Name<\/span><input type="text"[^>]*value="Box"/);
});

test('an axis field names its axis by the letter in the axis colour', () => {
  const html = renderToStaticMarkup(
    createElement(NumberField, { label: 'y', axis: 'y', value: 1.9, onCommit: noop }),
  );
  assert.match(html, /<span class="[^"]*bg-axis-y">y<\/span><input type="number"[^>]*value="1.9"/);
});
