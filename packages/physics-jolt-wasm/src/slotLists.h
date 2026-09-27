// A list of values per body slot, dense by slot: what finds a body's own vehicles (`vehicles.cpp`)
// without walking every one in the world (PHY-15); the body id's slot mask, shared with the pairs.
#pragma once

#include <cstdint>
#include <vector>

namespace trillion {

/// A body's engine id: its slot in the low bits, the slot's generation above (layout.ts BODY_INDEX),
/// so a record naming a body that left is never read as the one that took its slot.
constexpr uint32_t INDEX_MASK = 0x00FFFFFFu;

/// Takes `value` out of `list`, its last entry moved into its place.
template <class T>
void swapRemove(std::vector<T> &list, T value) {
  for (T &entry : list)
    if (entry == value) {
      entry = list.back();
      list.pop_back();
      return;
    }
}

template <class T>
class SlotLists {
 public:
  /// The values listed under `slot`, in no order.
  const std::vector<T> &at(uint32_t slot) const { return slot < lists.size() ? lists[slot] : none(); }
  void add(uint32_t slot, T value) {
    if (slot >= lists.size()) lists.resize(slot + 1);
    lists[slot].push_back(value);
  }
  /// An emptied list keeps its capacity: a body touching and leaving allocates nothing again.
  void remove(uint32_t slot, T value) {
    if (slot < lists.size()) swapRemove(lists[slot], value);
  }

 private:
  static const std::vector<T> &none() {
    static const std::vector<T> empty;
    return empty;
  }
  std::vector<std::vector<T>> lists;
};

}  // namespace trillion
