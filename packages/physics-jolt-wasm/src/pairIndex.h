// The touching pairs by engine ids (`World::pairs`), each also listed under both its bodies' slots:
// a body's removal leaves its own pairs (`leaveAll`) without walking every pair (PHY-15).
#pragma once

#include "slotLists.h"

#include <cstdint>
#include <unordered_map>

namespace trillion {

class PairIndex {
 public:
  using Counts = std::unordered_map<uint64_t, uint32_t>;
  static uint32_t slotOf(uint32_t engine) { return engine & INDEX_MASK; }

  /// The count of the pair `key` (`pairKey`), 0 for a new pair, which is listed under its bodies.
  uint32_t &operator[](uint64_t key) {
    auto [at, fresh] = counts.try_emplace(key, 0);
    if (fresh) {
      bodies.add(slotOf(uint32_t(key >> 32)), key);
      bodies.add(slotOf(uint32_t(key)), key);
    }
    return at->second;
  }
  Counts::iterator find(uint64_t key) { return counts.find(key); }
  Counts::iterator end() { return counts.end(); }
  void erase(Counts::iterator at) {
    bodies.remove(slotOf(uint32_t(at->first >> 32)), at->first);
    bodies.remove(slotOf(uint32_t(at->first)), at->first);
    counts.erase(at);
  }
  /// The pairs the body in `slot` is in, in no order.
  const std::vector<uint64_t> &of(uint32_t slot) const { return bodies.at(slot); }

 private:
  Counts counts;
  SlotLists<uint64_t> bodies;
};

}  // namespace trillion
