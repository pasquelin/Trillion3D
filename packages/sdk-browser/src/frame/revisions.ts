/**
 * The three revisions of a frame, and the witness that says whether the next frame can be held.
 *
 * Each counter is incremented at the origin of the change — where the scene, the view or the
 * resources are actually written — and never deduced from a walk: a walk to know whether to walk
 * costs what it claims to avoid. The three are separate because a frame's steps do not read the
 * same ones: a world box depends only on `scene` and `resources`, its screen rectangle on all three.
 */
export interface FrameRevisions {
  /** World matrices, materials, source geometry, lights: everything the scene carries. */
  scene: number;
  /** Camera, projection, resolution and quality settings: everything the viewpoint carries. */
  view: number;
  /** Page arrival or eviction, texture upload, residency, buffers. */
  resources: number;
}

export const createFrameRevisions = (): FrameRevisions => ({ scene: 1, view: 1, resources: 1 });

export const bumpScene = (revisions: FrameRevisions) => {
  revisions.scene++;
};
export const bumpView = (revisions: FrameRevisions) => {
  revisions.view++;
};
export const bumpResources = (revisions: FrameRevisions) => {
  revisions.resources++;
};

/**
 * Witness of a held frame: the three revisions of the last frame produced, and the signature of
 * what it produced.
 *
 * `stable` is true only after two consecutive frames whose revisions AND signature are identical.
 * That is the only honest way to cover states that converge from frame to frame without any write
 * announcing them — occluder history, the temporal pyramid, occlusion verdicts reread with a lag.
 * Two frames that produced exactly the same work would produce an identical third; one alone
 * proves nothing.
 *
 * Nothing forgets this witness without saying why: what changes the frame increments the revision
 * that names what it changed, and `same` becomes false at the same time.
 */
export function createFrameHold(values: number) {
  const held = new Float64Array(values);
  /** Where the caller writes the signature of the frame it has just produced. */
  const sample = new Float64Array(values);
  let scene = -1,
    view = -1,
    resources = -1,
    stable = false;
  // No frame retained: the three kept revisions are `-1`, which no counter reaches.
  const same = (revisions: FrameRevisions) =>
    scene === revisions.scene && view === revisions.view && resources === revisions.resources;
  return {
    sample,
    /** True when the revisions have not moved since the retained frame. */
    same,
    /** True when the last two retained frames produced exactly the same work. */
    get stable() {
      return stable;
    },
    /** Stores the frame that has just been produced: its revisions and its signature. */
    keep(revisions: FrameRevisions) {
      let repeated = same(revisions);
      for (let i = 0; repeated && i < values; i++) repeated = held[i] === sample[i];
      stable = repeated;
      held.set(sample);
      scene = revisions.scene;
      view = revisions.view;
      resources = revisions.resources;
    },
  };
}
