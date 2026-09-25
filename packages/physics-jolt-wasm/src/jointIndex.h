// The world's joints by body slot and kind (`joints.cpp`): what finds a body's joints, a gear's
// hinges and the gears a hinge or slider concerns without walking every joint.
#pragma once

#include <cstdint>
#include <unordered_map>
#include <vector>

namespace trillion {

class JointIndex {
 public:
  /// The joints (their index in the world's list) of `kind` with an end on the body in `slot`.
  const std::vector<uint32_t> &at(uint32_t slot, uint32_t kind) const {
    auto found = ends.find(key(slot, kind));
    return found == ends.end() ? none : found->second;
  }
  void add(uint32_t slot, uint32_t kind, uint32_t joint) { ends[key(slot, kind)].push_back(joint); }
  void remove(uint32_t slot, uint32_t kind, uint32_t joint) {
    auto found = ends.find(key(slot, kind));
    if (found == ends.end()) return;
    std::vector<uint32_t> &list = found->second;
    for (uint32_t &entry : list)
      if (entry == joint) {
        entry = list.back();
        list.pop_back();
        break;
      }
    if (list.empty()) ends.erase(found);
  }

 private:
  static uint64_t key(uint32_t slot, uint32_t kind) { return uint64_t(slot) << 8 | kind; }
  std::unordered_map<uint64_t, std::vector<uint32_t>> ends;
  const std::vector<uint32_t> none;
};

}  // namespace trillion
