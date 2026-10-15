// The world's joints by body slot (`joints.cpp`): what finds a body's joints, a gear's hinges and
// the gears a hinge or slider concerns without walking every joint — a body's few joints,
// filtered by kind —; and the joints the step walks (paths, breakable joints), so it never walks
// the others.
#pragma once

#include "slotLists.h"

#include <cstdint>
#include <vector>

namespace trillion {

class JointIndex {
 public:
  /// The world-wide lists the step walks.
  enum List : uint32_t { PATHS, BREAKABLE, LISTS };

  /// The joints (their index in the world's list) with an end on the body in `slot`, in no order.
  const std::vector<uint32_t> &at(uint32_t slot) const { return ends.at(slot); }
  void add(uint32_t slot, uint32_t joint) { ends.add(slot, joint); }
  void remove(uint32_t slot, uint32_t joint) { ends.remove(slot, joint); }
  /// Every joint in `list`, whatever its bodies.
  const std::vector<uint32_t> &every(List list) const { return lists[list]; }
  void mark(List list, uint32_t joint, bool in) { in ? lists[list].push_back(joint) : swapRemove(lists[list], joint); }

 private:
  SlotLists<uint32_t> ends;
  std::vector<uint32_t> lists[LISTS];
};

}  // namespace trillion
