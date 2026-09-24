// Native counterpart of the buoyancy timed by `scripts/bench-fluids.ts`, for comparison only (never
// shipped): the same scene words, and per step the module's own share of buoyancy — the pieces
// query and the BUOYANCY command — timed apart from the collision step. The planes are flat at
// the rest height (the wave model is TypeScript, timed by the TS bench).
//   water <commands.bin> <maxBodies> <threads> <steps> <sliceLength>
#include "../src/binding.h"

#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <vector>

extern "C" {
uint32_t jolt_init(uint32_t maxBodies, uint32_t bodyPairs, uint32_t contactConstraints,
                   uint32_t tempBytes, uint32_t threads);
uint32_t *jolt_buffer(uint32_t which, uint32_t words);
uint32_t jolt_step(uint32_t commandWords, float dt);
uint32_t jolt_water_query(float top, float sliceLength);
uint32_t *jolt_water_pieces();
}

/// layout.ts: OP.buoyancy, WATER_PIECE_WORDS, BUOYANCY_WORDS, PLANE_WORDS.
constexpr uint32_t BUOYANCY = 17, PIECE_WORDS = 6, HEADER_WORDS = 8, PLANE_WORDS = 8;

int main(int argc, char **argv) {
  if (argc != 6) {
    std::fprintf(stderr, "usage: water <commands.bin> <maxBodies> <threads> <steps> <sliceLength>\n");
    return 2;
  }
  FILE *file = std::fopen(argv[1], "rb");
  if (!file) return 1;
  std::vector<uint32_t> words;
  uint32_t word;
  while (std::fread(&word, 4, 1, file) == 1) words.push_back(word);
  std::fclose(file);
  uint32_t bodies = std::atoi(argv[2]), threads = std::atoi(argv[3]), steps = std::atoi(argv[4]);
  float slice = std::atof(argv[5]), dt = 1.0f / 60.0f;
  if (jolt_init(bodies, 65536, 10240, 16 * 1024 * 1024, threads) != 0) return 1;
  jolt_buffer(1, bodies * 14);
  jolt_buffer(2, 4096 * 7);
  std::memcpy(jolt_buffer(0, uint32_t(words.size())), words.data(), words.size() * 4);
  if (jolt_step(uint32_t(words.size()), 0) == 0xFFFFFFFFu || jolt_step(0, dt) == 0xFFFFFFFFu) return 1;
  std::vector<uint32_t> command;
  for (uint32_t s = 0; s < steps; s++) {
    auto t = std::chrono::steady_clock::now();
    uint32_t count = jolt_water_query(1.0f, slice);
    const uint32_t *pieces = jolt_water_pieces();
    command.assign(HEADER_WORDS + count * PLANE_WORDS, 0);
    float header[6] = {1000, 0.5f, 0.05f, 0, 0, 0}, plane[6];
    command[0] = BUOYANCY;
    command[1] = count;
    std::memcpy(&command[2], header, sizeof(header));
    for (uint32_t i = 0; i < count; i++) {
      uint32_t *out = &command[HEADER_WORDS + i * PLANE_WORDS];
      const uint32_t *in = pieces + i * PIECE_WORDS;
      out[0] = in[0];
      out[1] = in[1];
      std::memcpy(&plane[0], in + 2, 4);
      plane[1] = 0;
      std::memcpy(&plane[2], in + 3, 4);
      plane[3] = 0, plane[4] = 1, plane[5] = 0;
      std::memcpy(out + 2, plane, sizeof(plane));
    }
    trillion::runBuoyancy(command.data());
    double ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t).count();
    jolt_step(0, dt);
    std::printf("%.4f %u\n", ms, count);
  }
  return 0;
}
