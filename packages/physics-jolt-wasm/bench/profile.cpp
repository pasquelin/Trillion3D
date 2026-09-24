// Jolt's external profiler for the bench builds only (`-DPROFILE=ON`, never shipped): each
// profiled scope adds its duration, on whatever thread ran it, to a total per scope name. The
// totals are thread milliseconds: a phase run on four threads for 1 ms each counts 4 ms.
#include <Jolt/Jolt.h>

#include <Jolt/Core/Profiler.h>

#include <atomic>
#include <chrono>
#include <cstdint>
#include <cstring>
#include <mutex>

namespace {

constexpr uint32_t SCOPES = 256;
struct Scope {
  const char *name = nullptr;
  std::atomic<uint64_t> nanoseconds{0};
  std::atomic<uint32_t> calls{0};
};
Scope scopes[SCOPES];
std::mutex adding;

uint64_t now() {
  return uint64_t(std::chrono::duration_cast<std::chrono::nanoseconds>(
                      std::chrono::steady_clock::now().time_since_epoch())
                      .count());
}

Scope &scopeOf(const char *name) {
  // Scope names are string literals: one pointer per profiled site.
  uint32_t at = uint32_t(uintptr_t(name) >> 3) % SCOPES;
  for (uint32_t probe = 0; probe < SCOPES; probe++, at = (at + 1) % SCOPES) {
    if (scopes[at].name == name) return scopes[at];
    if (scopes[at].name == nullptr) {
      std::lock_guard guard(adding);
      if (scopes[at].name == nullptr) scopes[at].name = name;
      if (scopes[at].name == name) return scopes[at];
    }
  }
  return scopes[0];
}

struct Open {
  Scope *scope;
  uint64_t start;
};

}  // namespace

JPH_NAMESPACE_BEGIN

ExternalProfileMeasurement::ExternalProfileMeasurement(const char *inName, uint32) {
  static_assert(sizeof(Open) <= sizeof(mUserData));
  Open open{&scopeOf(inName), now()};
  std::memcpy(mUserData, &open, sizeof(open));
}

ExternalProfileMeasurement::~ExternalProfileMeasurement() {
  Open open;
  std::memcpy(&open, mUserData, sizeof(open));
  open.scope->nanoseconds += now() - open.start;
  open.scope->calls++;
}

JPH_NAMESPACE_END

extern "C" {

/// The name of scope slot `i` (null when unused), its thread milliseconds and calls since the
/// last reset.
const char *jolt_profile_name(uint32_t i) { return i < SCOPES ? scopes[i].name : nullptr; }
double jolt_profile_ms(uint32_t i) { return scopes[i].nanoseconds / 1e6; }
uint32_t jolt_profile_calls(uint32_t i) { return scopes[i].calls; }
void jolt_profile_reset() {
  for (Scope &scope : scopes) {
    scope.nanoseconds = 0;
    scope.calls = 0;
  }
}
}
