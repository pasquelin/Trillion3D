import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { geometry, light, material, math, object } from '../packages/sdk-browser/src/index.ts';
import { Camera } from '../packages/sdk-core/src/world/camera/camera.ts';
import { Scene } from '../packages/sdk-browser/src/world/core/scene.ts';
import { runExampleModule } from './docs/examples/capture.ts';

test('the component owns exactly one world for each attachment', async () => {
  const html = await readFile(
    new URL('../site/examples/inside-a-component.html', import.meta.url),
    'utf8',
  );
  const previous = {
    customElements: globalThis.customElements,
    document: globalThis.document,
    HTMLElement: globalThis.HTMLElement,
  };
  let element: TestElement | undefined;
  let created = 0;
  let disposed = 0;
  let buttons = {} as Record<'mount' | 'unmount' | 'remount', () => void>;

  class TestElement {
    isConnected = true;
    world?: { scene: { children: unknown[] } };
    connectedCallback?(): void;
    disconnectedCallback?(): void;
    remove() {
      if (!this.isConnected) return;
      this.isConnected = false;
      this.disconnectedCallback?.();
    }
  }
  const body = {
    append(node: TestElement) {
      if (node.isConnected) {
        node.isConnected = false;
        node.disconnectedCallback?.();
      }
      node.isConnected = true;
      node.connectedCallback?.();
    },
  };

  Object.assign(globalThis, {
    HTMLElement: TestElement,
    customElements: {
      define(_name: string, Component: new () => TestElement) {
        element = new Component();
        element.connectedCallback?.();
      },
    },
    document: {
      body,
      querySelector: () => element,
    },
  });

  try {
    await runExampleModule(html, {
      engine: {
        createWorld(target: TestElement) {
          assert.equal(target, element);
          created++;
          return {
            scene: new Scene(() => Promise.reject(new Error('the component loads no asset'))),
            camera: new Camera('perspective'),
            controls: { target: math.vector3(), maxPolarAngle: 0 },
            dispose() {
              disposed++;
            },
          };
        },
        geometry,
        light,
        material,
        math,
        object,
      },
      kit: {
        banner() {},
        controls(specs: typeof buttons) {
          buttons = specs;
        },
      },
    });

    assert.equal(created, 1);
    buttons.mount();
    assert.equal(created, 1, 'mount does not create a second world while attached');
    buttons.unmount();
    buttons.unmount();
    assert.deepEqual([created, disposed], [1, 1], 'detach disposes exactly once');
    buttons.mount();
    buttons.mount();
    assert.deepEqual([created, disposed], [2, 1], 'reattach creates exactly one fresh world');
    buttons.remount();
    assert.deepEqual([created, disposed], [3, 2], 'remount disposes before creating');
    assert.ok(element?.world);
    assert.equal(element.world.scene.children.length, 4, 'each world receives the same scene');
  } finally {
    Object.assign(globalThis, previous);
  }
});
