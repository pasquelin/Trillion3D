import {
  type AtlasLayout,
  type AtlasRect,
  type AtlasSlot,
  type CopySlot,
  type Point,
  type SourceImage,
  INVALID_ORIGIN,
  INVALID_SLOT,
  alignSlotSize,
  copyRect,
  freeSlot,
  hasPlace,
  newLayout,
  newRect,
  sourceResolution,
  toMip,
} from './layout.ts'
import { cleanAtlas, packAtlas } from './pack.ts'

/** The settings the atlas is updated under (`RECT_LIGHT_ATLAS_RULES`). */
export interface AtlasConfig {
  readonly maxResolution: number
  readonly maxRatio: number
  readonly forceUpdate: boolean
  readonly resetOnChange: boolean
  readonly clear: boolean
  /** The atlas is filled with magenta when it is made or cleared, in place of transparent. */
  readonly debugClear: boolean
  readonly filterQuality: number
  readonly format: number
}

/** What one update asks of the device, in the order it is done. */
export interface AtlasUpdate {
  /** A texture of this size is made: the atlas as it is to be. */
  made: Point | undefined
  /** The texture made is a new one the held atlas is copied into (`copySlots`), rather than a replacement of it. */
  copies: boolean
  /** The held atlas is cleared (it is not made again). */
  clear: boolean
  /** The slots that move from the held atlas to the new one. */
  copySlots: CopySlot[]
  /** The slots whose picture is drawn into the atlas, then filtered into their mip levels. */
  drawn: AtlasSlot[]
  /** How many mip levels smaller than their own the pictures are drawn. */
  sourceMipBias: number
}

/** A slot's place as the lights read it: the rectangle in texels, or none (`placed` false). */
export interface SlotPlace {
  readonly placed: boolean
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

const NO_PLACE: SlotPlace = { placed: false, x: 0, y: 0, width: 0, height: 0 }

/**
 * THE MANAGER OF THE RECTANGLE LIGHTS' ATLAS: the slots (one for each picture and share of it a light names, counted by the lights that
 * name it), the deleted rectangles waiting to become free rectangles, the layout, and the update that turns what changed into what the
 * device does. A picture is added when a light names it (`addTexture`) and given back when the light goes (`removeTexture`); the next
 * `update` packs the new slots into the held atlas, or makes the layout again when they do not fit. Nothing here touches a device.
 */
export function createRectLightAtlasManager() {
  const slots: AtlasSlot[] = []
  let deleted: AtlasRect[] = []
  let freeSlots: number[] = []
  const state = { layout: newLayout() }
  let atlas: Point | undefined
  let pendingAdds = false
  /** What the atlas was made under: a change of any is a reason to make it again. */
  let madeUnder: { maxResolution: number; format: number; filterQuality: number } | undefined

  const place = (slot: AtlasSlot): SlotPlace =>
    slot.source && hasPlace(slot.rect)
      ? {
          placed: true,
          x: slot.rect.origin.x,
          y: slot.rect.origin.y,
          width: slot.rect.size.x,
          height: slot.rect.size.y,
        }
      : NO_PLACE

  function resetAtlas(config: AtlasConfig) {
    madeUnder = {
      maxResolution: config.maxResolution,
      format: config.format,
      filterQuality: config.filterQuality,
    }
    pendingAdds = true
    state.layout = newLayout(config.maxResolution, config.maxResolution)
    deleted = []
    for (const slot of slots) slot.rect.origin = { x: INVALID_ORIGIN, y: INVALID_ORIGIN }
  }

  return {
    /** The slots, free ones included, by index. */
    slots: slots as readonly AtlasSlot[],
    get layout(): AtlasLayout {
      return state.layout
    },
    /** The size of the atlas texture the slots are in; none before the first. */
    get size() {
      return atlas
    },
    /** The slot of `image` showing the share `scaleOffset` of it: the one already held, counted once more, else a new one (`INVALID_SLOT` for no image). */
    addTexture(
      image: SourceImage | undefined,
      scaleOffset: readonly [number, number, number, number],
      maxRatio: number,
    ) {
      if (!image) return INVALID_SLOT
      const held = slots.find(
        (s) => s.source === image && s.scaleOffset.every((v, i) => v === scaleOffset[i]),
      )
      if (held) {
        held.refs++
        return held.id
      }
      const reused = freeSlots.shift()
      const id = reused ?? slots.length
      const slot = freeSlot()
      if (reused === undefined) slots.push(slot)
      else slots[id] = slot
      const size = sourceResolution(image, scaleOffset, maxRatio)
      Object.assign(slot, { id, source: image, scaleOffset, refs: 1, cachedSize: { ...size } })
      slot.rect = newRect()
      slot.rect.size = { ...size }
      alignSlotSize(slot.rect)
      pendingAdds = true
      return id
    },
    /** One light fewer names slot `id`; the last gives its rectangle back to the layout at the next update. */
    removeTexture(id: number) {
      const slot = slots[id]
      if (id === INVALID_SLOT || !slot || --slot.refs !== 0) return
      deleted.push(copyRect(slot.rect))
      if (id === slots.length - 1) slots.pop()
      else {
        freeSlots.push(id)
        slots[id] = freeSlot()
      }
    },
    /** Where slot `id` is in the atlas, none for a slot not yet placed or not held. */
    placeOf: (id: number): SlotPlace => (slots[id] ? place(slots[id]) : NO_PLACE),
    /** Draws every slot of `image` again at the next update: the picture changed (a live capture). Whether a slot held it. */
    refresh(image: SourceImage) {
      let held = false
      for (const slot of slots)
        if (slot.source === image) {
          held = true
          slot.forceRefresh = true
        }
      return held
    },
    /**
     * The update of an image: the layout cleaned of the deleted slots, the new slots packed, and what the device does about it. `undefined`
     * when nothing changes. The slots' places are the new ones as soon as this returns.
     */
    update(config: AtlasConfig): AtlasUpdate | undefined {
      madeUnder ??= {
        maxResolution: config.maxResolution,
        format: config.format,
        filterQuality: config.filterQuality,
      }
      const forceUpdate =
        config.forceUpdate ||
        state.layout.width > config.maxResolution ||
        madeUnder.maxResolution !== config.maxResolution ||
        madeUnder.format !== config.format ||
        madeUnder.filterQuality !== config.filterQuality
      // Another format is another texture, whatever the layout's size.
      if (madeUnder.format !== config.format) atlas = undefined
      if (forceUpdate) resetAtlas(config)
      // A picture that streamed in larger than its slot is given a new one.
      let refreshes = 0
      for (const slot of slots) {
        if (!slot.source) continue
        const size = toMip(
          sourceResolution(slot.source, slot.scaleOffset, config.maxRatio),
          state.layout.sourceMipBias,
        )
        if (size.x > slot.rect.size.x || size.y > slot.rect.size.y) {
          if (hasPlace(slot.rect)) deleted.push(copyRect(slot.rect))
          slot.rect.origin = { x: INVALID_ORIGIN, y: INVALID_ORIGIN }
          pendingAdds = true
        }
        if (slot.forceRefresh) refreshes++
      }
      // A picture drawn again in a new place gives its old one back.
      if (pendingAdds)
        for (const slot of slots)
          if (slot.source && slot.forceRefresh && hasPlace(slot.rect)) {
            deleted.push(copyRect(slot.rect))
            slot.rect.origin = { x: INVALID_ORIGIN, y: INVALID_ORIGIN }
          }
      if (pendingAdds && !forceUpdate && config.resetOnChange) resetAtlas(config)
      if (deleted.length) {
        cleanAtlas(state.layout, deleted)
        deleted = []
      }
      const update: AtlasUpdate = {
        made: undefined,
        copies: false,
        clear: false,
        copySlots: [],
        drawn: [],
        sourceMipBias: 0,
      }
      if (pendingAdds) {
        const packing = packAtlas(state, slots, config.maxResolution, config.maxRatio)
        const changed = packing.newSlots.length > 0 || packing.copySlots.length > 0
        if (changed) {
          const layoutSize = { x: state.layout.width, y: state.layout.height }
          const recreate =
            !atlas ||
            (packing.copySlots.length === 0 &&
              (atlas.x !== layoutSize.x || atlas.y !== layoutSize.y))
          if (recreate) update.made = layoutSize
          else if (config.clear && config.resetOnChange && packing.copySlots.length === 0)
            update.clear = true
          if (packing.copySlots.length > 0) {
            update.made = layoutSize
            update.copies = true
            update.copySlots = packing.copySlots
            for (const moved of packing.copySlots) {
              const slot = slots[moved.id]
              slot.rect.origin = { ...moved.dstOrigin }
              slot.rect.size = { ...moved.size }
              slot.forceRefresh = false
            }
          }
          if (update.made) atlas = update.made
          for (const added of packing.newSlots) {
            const slot = slots[added.id]
            slot.rect.origin = { ...added.rect.origin }
            slot.rect.size = { ...added.rect.size }
            slot.cachedSize = sourceResolution(slot.source, slot.scaleOffset, config.maxRatio)
            slot.forceRefresh = false
          }
          update.drawn = packing.newSlots.map((added) => slots[added.id])
          update.sourceMipBias = state.layout.sourceMipBias
        }
        pendingAdds = false
      } else if (refreshes > 0) {
        for (const slot of slots) {
          if (!slot.forceRefresh) continue
          slot.forceRefresh = false
          update.drawn.push(slot)
        }
        update.sourceMipBias = state.layout.sourceMipBias
      }
      return update.made || update.clear || update.drawn.length ? update : undefined
    },
  }
}

/** The manager of the rectangle lights' atlas. */
export type RectLightAtlasManager = ReturnType<typeof createRectLightAtlasManager>
