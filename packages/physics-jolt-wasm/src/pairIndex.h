// The touching pairs by engine ids (`World::pairs`), each also listed under both its bodies' slots:
// a body's removal leaves its own pairs (`leaveAll`) without walking every pair (PHY-15), and a
// pair's end unlists it at the position it keeps, never walking a body's list (a floor's is long).
// A soft body's pairs (`softContacts.cpp`) are also listed together, with the step that last saw
// each touch: Jolt reports a soft touch every step, never its end.
#pragma once

#include "slotLists.h"

#include <cstdint>
#include <unordered_map>
#include <vector>

namespace trillion {

class PairIndex {
 public:
  struct Pair {
    /** Sub-shape contacts, `ENTERED` once the page was told (`contacts.cpp`). */
    uint32_t count = 0;
    /** Its position in the lists of its bodies: the key's high engine id, then its low one. */
    uint32_t at[2] = {0, 0};
    /** A soft pair's position among the soft pairs (`NOT_SOFT` for a rigid one), and the step
     *  that last saw it touch. */
    uint32_t softAt = NOT_SOFT, touched = 0;
  };
  using Pairs = std::unordered_map<uint64_t, Pair>;
  static constexpr uint32_t NOT_SOFT = UINT32_MAX;

  /// The count of the pair `key` (`pairKey`), 0 for a new pair, which is listed under its bodies.
  uint32_t &operator[](uint64_t key) { return entry(key).count; }
  Pairs::iterator find(uint64_t key) { return pairs.find(key); }
  Pairs::iterator end() { return pairs.end(); }
  void erase(Pairs::iterator at) {
    for (int side = 0; side < 2; ++side) {
      uint32_t slot = slotOf(at->first, side), position = at->second.at[side];
      if (const uint64_t *moved = bodies.removeAt(slot, position))
        pairs.find(*moved)->second.at[slotOf(*moved, 0) == slot ? 0 : 1] = position;
    }
    if (uint32_t position = at->second.softAt; position != NOT_SOFT) {
      uint64_t moved = soft.back();
      soft.pop_back();
      if (position < soft.size()) soft[position] = moved, pairs.find(moved)->second.softAt = position;
    }
    pairs.erase(at);
  }
  /// The pairs the body in `slot` is in, in no order.
  const std::vector<uint64_t> &of(uint32_t slot) const { return bodies.at(slot); }
  /// Whether `key` is a soft pair already: only read during the step.
  bool isSoft(uint64_t key) const {
    auto found = pairs.find(key);
    return found != pairs.end() && found->second.softAt != NOT_SOFT;
  }
  /// The soft pair `key` touched at `step`: its count when the pair is new (listed under its
  /// bodies and among the soft pairs), null when it was one already.
  uint32_t *touchSoft(uint64_t key, uint32_t step) {
    Pair &pair = entry(key);
    pair.touched = step;
    if (pair.softAt != NOT_SOFT) return nullptr;
    pair.softAt = uint32_t(soft.size());
    soft.push_back(key);
    return &pair.count;
  }
  /// Every soft pair, in the order they began (but for those that ended since).
  const std::vector<uint64_t> &softPairs() const { return soft; }

 private:
  static uint32_t slotOf(uint64_t key, int side) { return uint32_t(key >> (side ? 0 : 32)) & INDEX_MASK; }
  Pair &entry(uint64_t key) {
    auto [at, fresh] = pairs.try_emplace(key);
    if (fresh)
      for (int side = 0; side < 2; ++side) at->second.at[side] = bodies.add(slotOf(key, side), key);
    return at->second;
  }
  Pairs pairs;
  /** The pairs of each body slot; an emptied list keeps its capacity. */
  SlotLists<uint64_t> bodies;
  std::vector<uint64_t> soft;
};

}  // namespace trillion
