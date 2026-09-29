import type { TestContext } from 'node:test';

/** Browser bitmap identity in Node; GPU doubles record the exact object handed to upload. */
export function bitmapFixture(t: TestContext) {
  class Bitmap {
    closed = false;
    readonly width: number;
    readonly height: number;
    constructor(width: number, height: number) {
      this.width = width;
      this.height = height;
    }
    close() {
      this.closed = true;
    }
  }
  const before = Reflect.get(globalThis, 'ImageBitmap');
  Reflect.set(globalThis, 'ImageBitmap', Bitmap);
  t.after(() => {
    if (before === undefined) Reflect.deleteProperty(globalThis, 'ImageBitmap');
    else Reflect.set(globalThis, 'ImageBitmap', before);
  });
  return (width = 2, height = 2) => new Bitmap(width, height) as ImageBitmap & { closed: boolean };
}
