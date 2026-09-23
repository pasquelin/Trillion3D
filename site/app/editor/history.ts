/** One edit of the scene, which knows how to take itself back and to do itself again. */
export interface Command {
  undo(): void;
  redo(): void;
}

/**
 * The editor's undo stack: commands done, then commands undone, at most `capacity` of the first.
 * A new command drops every undone one; past the capacity the oldest is forgotten.
 */
export function createHistory(capacity: number) {
  const done: Command[] = [];
  let undone: Command[] = [];
  return {
    /** Records a command already applied to the scene. */
    push(command: Command) {
      done.push(command);
      if (done.length > capacity) done.shift();
      undone = [];
    },
    /** Takes the last command back; false when there is none. */
    undo() {
      const command = done.pop();
      if (!command) return false;
      command.undo();
      undone.push(command);
      return true;
    },
    /** Does the last undone command again; false when there is none. */
    redo() {
      const command = undone.pop();
      if (!command) return false;
      command.redo();
      done.push(command);
      return true;
    },
    /** Forgets every command: the scene they edited is gone. */
    clear() {
      done.length = 0;
      undone = [];
    },
    get canUndo() {
      return done.length > 0;
    },
    get canRedo() {
      return undone.length > 0;
    },
  };
}

export type History = ReturnType<typeof createHistory>;
