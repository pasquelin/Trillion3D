import type { Object3D } from '../../../packages/sdk-browser/src/index.ts';
import { attachCommand, isWithin, reparentCommand, reversed, valueCommand } from './commands.ts';
import { build, duplicate, type AddKind } from './objects.ts';
import type { Session } from './session.ts';
import { clearAutosave, readAutosave } from './storage.ts';

/**
 * What the menus and the outliner do to the scene, each edit one command of the history. `name`
 * gives a new object its name; `failed` hears a scene or a model that could not be read.
 */
export function sceneActions(
  session: Session,
  name: (kind: AddKind) => string,
  failed: (error: unknown) => void,
) {
  const { engine, world } = session;
  const { scene } = world;
  /** Replaces the scene with a saved one; the history of the old one goes with it. */
  const read = async (json: unknown) => {
    await scene.fromJSON(json, world.camera);
    session.replaced();
  };
  return {
    add(kind: AddKind) {
      const node = build(engine, kind, name(kind));
      session.run(attachCommand(node, scene));
      session.select(node);
    },
    remove() {
      const node = session.selected;
      if (node?.parent) session.run(reversed(attachCommand(node, node.parent)));
    },
    duplicate() {
      const node = session.selected;
      const copy = node?.parent && duplicate(engine, node);
      if (!node?.parent || !copy) return;
      session.run(attachCommand(copy, node.parent));
      session.select(copy);
    },
    /** Moves `node` under `parent`, keeping where it stands; never under itself. */
    reparent(node: Object3D, parent: Object3D) {
      if (
        !node.parent ||
        !isWithin(node, scene) ||
        node.parent === parent ||
        isWithin(parent, node)
      )
        return;
      session.run(reparentCommand(node, parent));
    },
    rename(node: Object3D, next: string) {
      if (next !== node.name)
        session.run(valueCommand((value: string) => (node.name = value), node.name, next));
    },
    setVisible(node: Object3D, visible: boolean) {
      session.run(valueCommand((value: boolean) => (node.visible = value), node.visible, visible));
    },
    /** An empty scene: every object goes, the grid, the axes and the handles stay. */
    newScene() {
      scene.remove(...session.content);
      session.replaced();
    },
    /** The scene as the JSON a file keeps. */
    save: () => JSON.stringify(scene.toJSON(world.camera), null, 2),
    open: (json: unknown) => read(json).catch(failed),
    /** A cooked model, loaded from its manifest's address and added as one undoable edit. */
    async loadSample(url: string, label: string) {
      try {
        const model = await scene.load(url);
        model.name = label;
        session.record(attachCommand(model, scene));
        session.select(model);
      } catch (error) {
        failed(error);
      }
    },
    /** The scene saved in this browser on the last visit, if any; one that fails is forgotten. */
    async restore() {
      const json = readAutosave();
      if (!json) return;
      await read(json).catch((error: unknown) => {
        clearAutosave();
        failed(error);
      });
    },
  };
}

export type SceneActions = ReturnType<typeof sceneActions>;
