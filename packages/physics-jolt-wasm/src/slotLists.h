// A list of values per body slot, dense by slot: what finds a body's own pairs (`pairIndex.h`),
// joints (`jointIndex.h`) and vehicles (`vehicles.cpp`) without walking every one in the world
// (PHY-15); the body id's slot mask is layout.h's.
#pragma once

#include <cstdint>
#include <vector>

#include "layout.h"

namespace trillion {

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
  /// Lists `value` under `slot`; returns its position there, which `removeAt` takes.
  uint32_t add(uint32_t slot, T value) {
    if (slot >= lists.size()) lists.resize(slot + 1);
    lists[slot].push_back(value);
    return uint32_t(lists[slot].size() - 1);
  }
  /// Takes `value` out of `slot`'s list, found by a walk of it (a short list).
  /// An emptied list keeps its capacity: a body touching and leaving allocates nothing again.
  void remove(uint32_t slot, T value) {
    if (slot < lists.size()) swapRemove(lists[slot], value);
  }
  /// Takes the entry at `position` out of `slot`'s list without a walk, its last entry moved into
  /// its place: that moved entry, whose position is now `position`, or null when none moved.
  const T *removeAt(uint32_t slot, uint32_t position) {
    std::vector<T> &list = lists[slot];
    T moved = list.back();
    list.pop_back();
    if (position == list.size()) return nullptr;
    list[position] = moved;
    return &list[position];
  }

 private:
  static const std::vector<T> &none() {
    static const std::vector<T> empty;
    return empty;
  }
  std::vector<std::vector<T>> lists;
};

}  // namespace trillion
