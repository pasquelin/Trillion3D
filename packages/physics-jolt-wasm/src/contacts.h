// The event records the contact listeners share, rigid pairs (`contacts.cpp`) and soft ones
// (`softContacts.cpp`): pairs keyed by engine ids, enters and leaves in the event buffer.
#pragma once

#include "binding.h"

namespace trillion {

/// The key of the pair of engine ids `a` and `b`, in either order.
uint64_t pairKey(uint32_t a, uint32_t b);
/// Set on a pair's count once its enter reached the event buffer: only then is a leave owed.
constexpr uint32_t ENTERED = 0x80000000u;
/// Writes one event record (1 enter, 2 leave); false when the event buffer is full.
bool pushEvent(uint32_t type, uint32_t a, uint32_t b, float impulse, JPH::Vec3 point);
/// A leave the buffer cannot take waits for the next step: an enter the page saw always ends.
void pushLeave(uint64_t key);
/// Whether the body of engine id `engine` asked for contact events.
bool wantsEvents(uint32_t engine);
/// The engine id of a body a contact names, or `~0u` when that body was removed since.
uint32_t live(const JPH::BodyID &id);

}  // namespace trillion
