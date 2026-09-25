// The world's joints by body slot and kind (`joints.cpp`): what finds a body's joints, a gear's
// hinges and the gears a hinge or slider concerns without walking every joint; and, for a kind
// the step walks (paths), every joint of that kind.
#pragma once

#include <cstdint>
#include <unordered_map>
#include <vector>

namespace trillion {

class JointIndex {
 public:
  /// The joints (their index in the world's list) of `kind` with an end on the body in `slot`.
  const std::vector<uint32_t> &at(uint64_t slot, uint32_t kind) const {
    auto found = ends.find(key(slot, kind));
    return found == ends.end() ? none : found->second;
  }
  void add(uint64_t slot, uint32_t kind, uint32_t joint) { ends[key(slot, kind)].push_back(joint); }
  void remove(uint64_t slot, uint32_t kind, uint32_t joint) {
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
  /// Every joint of `kind` listed by `list`, whatever its bodies.
  const std::vector<uint32_t> &every(uint32_t kind) const { return at(EVERY, kind); }
  void list(uint32_t kind, uint32_t joint, bool in) { in ? add(EVERY, kind, joint) : remove(EVERY, kind, joint); }

 private:
  /// The slot `every` lists a kind under: past any 32-bit body slot, so it names none.
  static constexpr uint64_t EVERY = uint64_t(1) << 32;
  static uint64_t key(uint64_t slot, uint32_t kind) { return slot << 8 | kind; }
  std::unordered_map<uint64_t, std::vector<uint32_t>> ends;
  const std::vector<uint32_t> none;
};

}  // namespace trillion
