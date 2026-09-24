import type { PortalEntry } from '../model.ts';

/** Guides of the scene editor's three doors — pick, move, save — and of the editor itself. */
const GUIDE = { section: 'guides', kind: 'Guide' };

export const EDITOR_GUIDES: PortalEntry[] = [
  {
    ...GUIDE,
    id: 'scene-editor',
    title: 'Build a scene with the editor',
    description:
      'Add shapes and lights, pick them with the mouse, move them with handles, recolour them, save the scene and open it again — in the portal, on the public API alone.',
    html: `<p>The <a href="#/en/editor">scene editor</a> is a page of this portal built on three doors of the engine and nothing else. Start from an empty scene: <b>Add → Box</b>, then <b>Add → Directional light</b>. Click the box: <code>world.raycast</code> finds it under the pointer, and the handles of <code>controls.transform</code> appear on it. Drag an arrow to move it — the camera rests while a handle is held — press <kbd>E</kbd> to turn it, <kbd>R</kbd> to scale it. Change its colour in the inspector: the engine repaints the material in place, the frame's cost stays in the stats corner. <b>Save</b> downloads <code>scene.toJSON</code>; <b>New</b>, then <b>Open</b>, builds the same scene again with <code>scene.fromJSON</code>.</p>
<p>Every step is undone with <kbd>Ctrl</kbd>+<kbd>Z</kbd>, and the scene is kept in the browser between two visits. Nothing is drawn or moved by the page itself: what you see is the engine.</p>`,
  },
  {
    ...GUIDE,
    id: 'pick-with-the-pointer',
    title: 'Pick an object with the pointer',
    description:
      '`world.raycast` returns the nearest object under a canvas point: the node the page added, the point and normal hit, the distance.',
    html: `<p>The test runs on the CPU over the scene's own geometry: triangle meshes triangle by triangle, a loaded model on its box, lines and points never. Hidden subtrees and <code>helper</code> marks are skipped. See it in <a href="#/en/examples/click-to-pick">Click to pick</a>.</p>`,
    example: `world.canvas.addEventListener('click', (event) => {
  const hit = world.raycast({ x: event.offsetX, y: event.offsetY });
  if (hit) hit.object.material.color.set('#ffb347');
});`,
  },
  {
    ...GUIDE,
    id: 'move-with-handles',
    title: 'Move, turn and scale with handles',
    description:
      '`controls.transform(world)` puts handles on one object; a drag writes its pose through its parents, and the camera rests meanwhile.',
    html: `<p>Modes <code>translate</code>, <code>rotate</code> and <code>scale</code>, world or local axes, optional steps. The events <code>dragStart</code> and <code>dragEnd</code> frame one drag — one undo step. See it in <a href="#/en/examples/move-rotate-scale-gizmo">Move, rotate, scale</a>.</p>`,
    example: `const gizmo = controls.transform(world).attach(crate);
gizmo.setMode('rotate');
gizmo.snap = { rotate: Math.PI / 12 };
gizmo.addEventListener('dragEnd', () => history.push(crate.quaternion.clone()));`,
  },
  {
    ...GUIDE,
    id: 'save-and-open-a-scene',
    title: 'Save and open a scene',
    description:
      '`scene.toJSON(camera)` writes the scene as plain versioned JSON; `scene.fromJSON(json, camera)` builds it again.',
    html: `<p>Shapes are stored by the call that built them, materials by their values, loaded models by their address — never inlined — and <code>helper</code> marks not at all. Another format version is refused by name. See it in <a href="#/en/examples/save-the-scene">Save the scene</a>.</p>`,
    example: `const saved = JSON.stringify(world.scene.toJSON(world.camera));
// … later, or in another page:
await world.scene.fromJSON(JSON.parse(saved), world.camera);`,
  },
];
