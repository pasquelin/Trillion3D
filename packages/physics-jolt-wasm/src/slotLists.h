// A list of values per key, dense by key — a body slot, or a list's number —: what finds a body's
// own pairs (`pairIndex.h`), joints (`joints.cpp`) and vehicles (`vehicles.cpp`) without walking
// every one in the world (PHY-15), and holds the joints the step walks.
#pragma once

#include <cstdint>
#include <vector>

#include "layout.h"

namespace trillion {

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
  /// Takes the entry at `position` out of `slot`'s list without a walk, its last entry moved into
  /// its place: that moved entry, whose position is now `position`, or null when none moved. Every
  /// owner of an entry keeps its position; an emptied list keeps its capacity.
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
