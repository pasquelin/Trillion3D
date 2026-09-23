import type { Object3D } from '../../../packages/sdk-browser/src/index.ts';
import type { Engine } from '../../lessons/lessonWorld.ts';
import { SCENE_BACKGROUND } from '../../lessons/scenePalette.ts';
import { createHistory, type Command } from './history.ts';
import { isWithin, poseCommand, poseOf, samePose, type Pose } from './commands.ts';
import { writeAutosave } from './storage.ts';

/** Edits the history keeps: a UI capacity (how far back a person steps), not a memory budget —
 *  each command holds a few numbers, or an object that was removed. */
const HISTORY_CAPACITY = 100;
/** The steps snapping rounds a drag to: half a grid square, 15°, a tenth of the size. */
const SNAP = { translate: 0.5, rotate: Math.PI / 12, scale: 0.1 };

/**
 * The editor's hold on one world: its helper marks (grid, axes, selection outline, the handles),
 * the selection, and the history every edit goes through. After each edit the outline follows,
 * the scene is saved in the browser and `changed` tells the page to draw its panels again.
 */
export function createSession(engine: Engine, canvas: HTMLCanvasElement, changed: () => void) {
  const world = engine.createWorld(canvas, { controls: 'orbit' });
  const { scene } = world;
  scene.background = engine.math.color(SCENE_BACKGROUND.packed);
  world.camera.position.set(5, 4, 7);
  world.camera.lookAt(0, 0.5, 0);
  world.controls.target?.set(0, 0.5, 0);
  const gizmo = engine.controls.transform(world, { mode: 'translate', space: 'world' });
  const helpers = new Set<Object3D>([engine.helper.grid(10, 10), engine.helper.axes(1)]);
  scene.add(...helpers);
  helpers.add(gizmo.handles);
  const history = createHistory(HISTORY_CAPACITY);
  let selected: Object3D | null = null,
    outline: Object3D | null = null,
    snapping = false;

  /** The outline takes the selection's world pose, after every move of it. */
  const follow = () => {
    if (!outline || !selected) return;
    selected.updateWorldMatrix(true, false);
    selected.matrixWorld.decompose(outline.position, outline.quaternion, outline.scale);
  };
  /** The outline is the selection's own box — a mesh's shape, a loaded model's bounds — built
   *  again only when that box changes. */
  let outlined: unknown = null;
  const refreshOutline = () => {
    const box = selected?.localBounds() ?? null;
    if (box !== outlined) {
      if (outline) {
        outline.removeFromParent();
        helpers.delete(outline);
      }
      outline = box && engine.helper.box(box, '#ffcc00');
      if (outline) {
        helpers.add(outline);
        scene.add(outline);
      }
      outlined = box;
    }
    follow();
  };
  const inScene = (node: Object3D | null) => isWithin(node, scene);
  const select = (node: Object3D | null) => {
    selected = node && inScene(node) ? node : null;
    if (selected) gizmo.attach(selected);
    else gizmo.detach();
    refreshOutline();
    changed();
  };
  const saved = () => {
    writeAutosave(() => JSON.stringify(scene.toJSON(world.camera)));
  };
  /** What follows every edit, done, undone or redone. */
  const edited = () => {
    if (selected && !inScene(selected)) select(null);
    else refreshOutline();
    world.invalidate();
    saved();
    changed();
  };

  let dragFrom: Pose | null = null;
  gizmo.addEventListener('dragStart', () => {
    dragFrom = selected && poseOf(selected);
  });
  gizmo.addEventListener('change', () => {
    follow();
    changed();
  });
  gizmo.addEventListener('dragEnd', () => {
    const after = selected && poseOf(selected);
    // A press on a handle that moved nothing is no edit: it must not clear what redo holds.
    if (selected && dragFrom && after && !samePose(dragFrom, after))
      session.record(poseCommand(selected, dragFrom, after));
    dragFrom = null;
  });

  const session = {
    engine,
    world,
    gizmo,
    history,
    get selected() {
      return selected;
    },
    get snapping() {
      return snapping;
    },
    /** The scene's own objects, its helper marks left out. */
    get content() {
      return scene.children.filter((child) => !helpers.has(child));
    },
    select,
    /** Applies `command` and records it. */
    run(command: Command) {
      command.redo();
      session.record(command);
    },
    /** Records a command already applied: a drag, a live colour. */
    record(command: Command) {
      history.push(command);
      edited();
    },
    undo() {
      if (history.undo()) edited();
    },
    redo() {
      if (history.redo()) edited();
    },
    /** Called after the scene was replaced: nothing is selected, the old history is void. */
    replaced() {
      history.clear();
      select(null);
      world.invalidate();
      saved();
    },
    setMode(mode: 'translate' | 'rotate' | 'scale') {
      gizmo.setMode(mode);
      changed();
    },
    setSpace(space: 'world' | 'local') {
      gizmo.setSpace(space);
      changed();
    },
    setSnap(on: boolean) {
      snapping = on;
      gizmo.snap = on ? { ...SNAP } : {};
      changed();
    },
    dispose() {
      gizmo.dispose();
      world.dispose();
    },
  };
  return session;
}

export type Session = ReturnType<typeof createSession>;
