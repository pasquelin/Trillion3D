import assert from 'node:assert/strict';
import test from 'node:test';
import { examplePlaceholder } from '../site/app/examples/list.ts';
import { loadReactComponents } from './docs/render-react.ts';

test('a missing thumbnail falls back once and leaves a missing placeholder alone', async () => {
  const { Cover } = (await loadReactComponents('site/app/ui/Thumbnail.tsx')) as {
    Cover: (props: { src: string; fallbackSrc?: string }) => {
      props: { onError: (event: unknown) => void };
    };
  };
  let source = './assets/examples/thumbnails/missing.png';
  let assignments = 0;
  const image = {
    getAttribute: (name: string) => (name === 'src' ? source : null),
    get src() {
      return source;
    },
    set src(value: string) {
      source = value;
      assignments++;
    },
  };
  const onError = Cover({ src: source, fallbackSrc: examplePlaceholder }).props.onError;
  onError({ currentTarget: image });
  onError({ currentTarget: image });
  assert.equal(source, examplePlaceholder);
  assert.equal(assignments, 1);
});
