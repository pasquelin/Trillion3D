#pragma once
#include <cstdint>
#include <cstdio>
#include <vector>

// The benches consume complete native command words; a trailing partial word is ignored.
inline bool readCommands(const char *path, std::vector<uint32_t> &words) {
  FILE *file = std::fopen(path, "rb");
  if (!file) return false;
  uint32_t word;
  while (std::fread(&word, 4, 1, file) == 1) words.push_back(word);
  std::fclose(file);
  return true;
}
