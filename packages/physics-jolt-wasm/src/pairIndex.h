// The touching pairs by engine ids (`World::pairs`), each also listed under both its bodies: a
// body's removal leaves its own pairs (`leaveAll`) without walking every pair in the world (PHY-15).
#pragma once

#include <cstdint>
#include <unordered_map>
#include <vector>

namespace trillion {

class PairIndex {
 public:
  using Counts = std::unordered_map<uint64_t, uint32_t>;

  /// The count of the pair `key` (`pairKey`), 0 for a new pair, which is listed under its bodies.
  uint32_t &operator[](uint64_t key) {
    auto [at, fresh] = counts.try_emplace(key, 0);
    if (fresh) {
      bodies[uint32_t(key >> 32)].push_back(key);
      bodies[uint32_t(key)].push_back(key);
    }
    return at->second;
  }
  Counts::iterator find(uint64_t key) { return counts.find(key); }
  Counts::iterator end() { return counts.end(); }
  void erase(Counts::iterator at) {
    unlist(uint32_t(at->first >> 32), at->first);
    unlist(uint32_t(at->first), at->first);
    counts.erase(at);
  }
  /// The pairs the body of engine id `engine` is in, in no order.
  const std::vector<uint64_t> &of(uint32_t engine) const {
    auto found = bodies.find(engine);
    return found == bodies.end() ? none : found->second;
  }

 private:
  /// Takes `key` off `engine`'s list, its last entry moved into its place.
  void unlist(uint32_t engine, uint64_t key) {
    auto found = bodies.find(engine);
    if (found == bodies.end()) return;
    std::vector<uint64_t> &list = found->second;
    for (uint64_t &entry : list)
      if (entry == key) {
        entry = list.back();
        list.pop_back();
        break;
      }
    if (list.empty()) bodies.erase(found);
  }
  Counts counts;
  std::unordered_map<uint32_t, std::vector<uint64_t>> bodies;
  const std::vector<uint64_t> none;
};

}  // namespace trillion
