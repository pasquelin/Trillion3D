// Oracles du lot « coupe par différence » : le code d'avant, recopié tel quel. Les quatre lecteurs
// de la coupe reparcouraient la liste publiée par le relevé à chaque image ; le banc les compare à
// ceux qui ne lisent plus qu'une différence. Les copies sont des doublons voulus : c'est l'oracle.

/** `webgpuPagesHelpers.ts:shownFromGpu` avant le lot : quatre totaux d'une passe sur toute la coupe. */
export function referenceCutCounts(pages, ids, residentOffsetWords) {
  let selected = 0,
    uncovered = 0,
    transparent = 0;
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i],
      rec = pages[id];
    if (!rec) continue;
    selected += rec.triangles;
    if (rec.transparent) transparent += rec.triangles;
    if (residentOffsetWords[id] < 0 || !rec.array) uncovered += rec.triangles;
  }
  return {
    selectedTriangles: selected,
    drawnTriangles: selected - uncovered,
    uncoveredTriangles: uncovered,
    transparentTriangles: transparent,
  };
}

/** `webgpuFrameHold.ts:cutComplete` avant le lot : la coupe entière relue pour un seul verdict. */
export function referenceCutComplete(desired) {
  for (let i = 0; i < desired.length; i++) if (!desired[i].array) return false;
  return true;
}

/** `webgpuPagesHostApi.ts:pendingUrls` avant le lot : `collectPendingUrls` sur toute la coupe. */
export function referencePendingUrls(desired, stamps, into) {
  into.length = 0;
  stamps.begin();
  return stamps.mark(desired, into, true);
}

/**
 * `webgpuBudgetRanking.ts` avant le lot, recopié tel quel : les comptes par niveau étaient déjà
 * tenus par `add`/`remove`, seul le préfixe était écrit en parcourant la coupe entière, une
 * estampille par clé pour le dédoublonnage. Seul ce parcours change, et c'est lui que le banc pèse.
 */
export function createReferenceRanking({ keyCount, bootstrapKey, keyOf }) {
  const levelOf = (page) => page.level ?? 0;
  let held = new Int32Array(8),
    counts = new Int32Array(8),
    cursors = new Int32Array(8);
  const refs = new Int32Array(Math.max(1, keyCount));
  const heldKeys = new Uint8Array(Math.max(1, keyCount));
  let heldCount = 0;
  const ranked = [];
  let keys = new Int32Array(0);
  const seen = new Int32Array(Math.max(1, keyCount)).fill(-1);
  let epoch = 0,
    length = 0;
  const grow = (level) => {
    if (level < held.length) return;
    const size = 1 << (32 - Math.clz32(level));
    const nextHeld = new Int32Array(size),
      nextCounts = new Int32Array(size);
    nextHeld.set(held);
    nextCounts.set(counts);
    held = nextHeld;
    counts = nextCounts;
    cursors = new Int32Array(size);
  };
  return {
    ranked,
    get keys() {
      return keys;
    },
    get length() {
      return length;
    },
    add(page) {
      const key = keyOf(page);
      if (bootstrapKey[key] || refs[key]++ > 0) return;
      const level = levelOf(page);
      grow(level);
      held[level]++;
      heldKeys[key] = 1;
      heldCount++;
    },
    remove(page) {
      const key = keyOf(page);
      if (bootstrapKey[key] || refs[key] <= 0 || --refs[key] > 0) return;
      held[levelOf(page)]--;
      heldKeys[key] = 0;
      heldCount--;
    },
    rank(room, cut) {
      const records = heldCount;
      counts.set(held);
      if (records <= room) return records;
      if (keys.length < room) {
        keys = new Int32Array(room);
        ranked.length = room;
      }
      let taken = 0,
        floor = 0,
        atCut = 0;
      for (let level = counts.length - 1; level >= 0; level--) {
        if (taken + counts[level] >= room) {
          floor = level;
          atCut = room - taken;
          break;
        }
        taken += counts[level];
      }
      let base = 0;
      for (let level = counts.length - 1; level > floor; level--) {
        cursors[level] = base;
        base += counts[level];
      }
      cursors[floor] = base;
      epoch++;
      let left = atCut;
      for (let i = 0; i < cut.length; i++) {
        const page = cut[i],
          key = keyOf(page),
          level = levelOf(page);
        if (level < floor || bootstrapKey[key] || seen[key] === epoch) continue;
        if (level === floor) {
          if (left === 0) continue;
          left--;
        }
        seen[key] = epoch;
        keys[cursors[level]] = key;
        ranked[cursors[level]] = page;
        cursors[level]++;
      }
      length = room;
      return records;
    },
  };
}

/** Le préfixe résumé par ce que les deux versions doivent rendre identique : autant de pages prises
 *  à chaque niveau. L'ordre interne d'un niveau, lui, n'est plus une promesse. */
export function levelHistogram(keys, length, levelOfKey) {
  const levels = [];
  for (let i = 0; i < length; i++) {
    const level = levelOfKey[keys[i]];
    levels[level] = (levels[level] ?? 0) + 1;
  }
  for (let i = 0; i < levels.length; i++) levels[i] = levels[i] ?? 0;
  return levels;
}
