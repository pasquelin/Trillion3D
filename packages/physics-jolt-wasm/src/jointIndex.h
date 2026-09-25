// The world's joints by body slot and kind (`joints.cpp`): what finds a body's joints, a gear's
// hinges and the gears a hinge or slider concerns without walking every joint; and the joints the
// step walks (paths, breakable joints), so it never walks the others.
#pragma once

#include <cstdint>
#include <unordered_map>
#include <vector>

namespace trillion {

class JointIndex {
 public:
  /// The world-wide lists the step walks.
  enum List : uint32_t { PATHS, BREAKABLE, LISTS };

  /// The joints (their index in the world's list) of `kind` with an end on the body in `slot`.
  const std::vector<uint32_t> &at(uint32_t slot, uint32_t kind) const {
    auto found = ends.find(key(slot, kind));
    return found == ends.end() ? none : found->second;
  }
  void add(uint32_t slot, uint32_t kind, uint32_t joint) { ends[key(slot, kind)].push_back(joint); }
  void remove(uint32_t slot, uint32_t kind, uint32_t joint) {
    auto found = ends.find(key(slot, kind));
    if (found == ends.end()) return;
    drop(found->second, joint);
    if (found->second.empty()) ends.erase(found);
  }
  /// Every joint in `list`, whatever its bodies.
  const std::vector<uint32_t> &every(List list) const { return lists[list]; }
  void mark(List list, uint32_t joint, bool in) { in ? lists[list].push_back(joint) : drop(lists[list], joint); }

 private:
  static uint64_t key(uint32_t slot, uint32_t kind) { return uint64_t(slot) << 8 | kind; }
  /// Takes `joint` out of `list`, its last entry moved into its place.
  static void drop(std::vector<uint32_t> &list, uint32_t joint) {
    for (uint32_t &entry : list)
      if (entry == joint) {
        entry = list.back();
        list.pop_back();
        return;
      }
  }
  std::unordered_map<uint64_t, std::vector<uint32_t>> ends;
  std::vector<uint32_t> lists[LISTS];
  const std::vector<uint32_t> none;
};

}  // namespace trillion
