// The touching pairs by engine ids (`World::pairs`), each also listed under both its bodies' slots:
// a body's removal leaves its own pairs (`leaveAll`) without walking every pair (PHY-15), and a
// pair's end unlists it at the position it keeps, never walking a body's list (a floor's is long).
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
  };
  using Pairs = std::unordered_map<uint64_t, Pair>;

  /// The count of the pair `key` (`pairKey`), 0 for a new pair, which is listed under its bodies.
  uint32_t &operator[](uint64_t key) {
    auto [at, fresh] = pairs.try_emplace(key);
    if (fresh)
      for (int side = 0; side < 2; ++side) {
        uint32_t slot = slotOf(key, side);
        if (slot >= bodies.size()) bodies.resize(slot + 1);
        std::vector<uint64_t> &list = bodies[slot];
        at->second.at[side] = uint32_t(list.size());
        list.push_back(key);
      }
    return at->second.count;
  }
  Pairs::iterator find(uint64_t key) { return pairs.find(key); }
  Pairs::iterator end() { return pairs.end(); }
  void erase(Pairs::iterator at) {
    for (int side = 0; side < 2; ++side) unlist(slotOf(at->first, side), at->second.at[side]);
    pairs.erase(at);
  }
  /// The pairs the body in `slot` is in, in no order.
  const std::vector<uint64_t> &of(uint32_t slot) const {
    static const std::vector<uint64_t> none;
    return slot < bodies.size() ? bodies[slot] : none;
  }

 private:
  static uint32_t slotOf(uint64_t key, int side) { return uint32_t(key >> (side ? 0 : 32)) & INDEX_MASK; }
  /// Takes the entry at `position` out of the list of `slot`, its last entry moved into its place.
  void unlist(uint32_t slot, uint32_t position) {
    std::vector<uint64_t> &list = bodies[slot];
    uint64_t moved = list.back();
    list.pop_back();
    if (position == list.size()) return;
    list[position] = moved;
    pairs.find(moved)->second.at[slotOf(moved, 0) == slot ? 0 : 1] = position;
  }
  Pairs pairs;
  /** The pairs of each body slot; an emptied list keeps its capacity. */
  std::vector<std::vector<uint64_t>> bodies;
};

}  // namespace trillion
