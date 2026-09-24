// Native counterpart of `scripts/bench-physics.ts`, for comparison only (never shipped): the same
// flat C API compiled natively against the same Jolt, fed the same command words (a file the TS
// bench writes), stepped the same way, timed by the same rule.
//   native <commands.bin> <maxBodies> <threads> <steps>
#include <chrono>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <vector>

extern "C" {
uint32_t jolt_init(uint32_t maxBodies, uint32_t tempBytes, uint32_t threads);
uint32_t *jolt_buffer(uint32_t which, uint32_t words);
uint32_t jolt_step(uint32_t commandWords, float dt, uint32_t substeps);
uint32_t jolt_active_count();
}

#ifdef JPH_EXTERNAL_PROFILE
// The profiled build's totals (`-DPROFILE=ON`, `bench/profile.cpp`).
extern "C" {
const char *jolt_profile_name(uint32_t i);
double jolt_profile_ms(uint32_t i);
void jolt_profile_reset();
}
constexpr bool PROFILED = true;
#else
constexpr bool PROFILED = false;
const char *jolt_profile_name(uint32_t) { return nullptr; }
double jolt_profile_ms(uint32_t) { return 0; }
void jolt_profile_reset() {}
#endif

/// The landing window the profile covers (`scripts/bench-physics.ts`, PROFILE_FROM / PROFILE_TO).
constexpr uint32_t PROFILE_FROM = 50, PROFILE_TO = 180;

int main(int argc, char **argv) {
  if (argc != 5) {
    std::fprintf(stderr, "usage: native <commands.bin> <maxBodies> <threads> <steps>\n");
    return 2;
  }
  FILE *file = std::fopen(argv[1], "rb");
  if (!file) return 1;
  std::vector<uint32_t> words;
  uint32_t word;
  while (std::fread(&word, 4, 1, file) == 1) words.push_back(word);
  std::fclose(file);
  uint32_t maxBodies = std::atoi(argv[2]), threads = std::atoi(argv[3]), steps = std::atoi(argv[4]);
  // The same scratch and buffers as the web loader (`joltModule.ts`).
  if (jolt_init(maxBodies, 16 * 1024 * 1024, threads) != 0) return 1;
  jolt_buffer(1, maxBodies * 14);
  jolt_buffer(2, 4096 * 7);
  std::memcpy(jolt_buffer(0, uint32_t(words.size())), words.data(), words.size() * 4);
  if (jolt_step(uint32_t(words.size()), 0, 1) == 0xFFFFFFFFu) return 1;
  // One line per step: its milliseconds and the bodies awake after it.
  for (uint32_t s = 0; s < steps; s++) {
    if (PROFILED && s == PROFILE_FROM) jolt_profile_reset();
    if (PROFILED && s == PROFILE_TO)
      for (uint32_t i = 0; i < 256; i++)
        if (jolt_profile_name(i))
          std::printf("#\t%s\t%.4f\n", jolt_profile_name(i),
                      jolt_profile_ms(i) / (PROFILE_TO - PROFILE_FROM));
    auto t = std::chrono::steady_clock::now();
    jolt_step(0, 1.0f / 60.0f, 1);
    double ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t).count();
    std::printf("%.3f %u\n", ms, jolt_active_count());
  }
  return 0;
}
