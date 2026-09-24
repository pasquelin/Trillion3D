// Jolt's binary state in memory: the stream a cooked shape is written to by the compiler
// (`cook/cook.cpp`) and read from by the physics worker (`src/restore.cpp`). One format on both
// sides: `Shape::SaveWithChildren` / `Shape::sRestoreWithChildren` of the same pinned Jolt.
#pragma once

#include <Jolt/Jolt.h>

#include <Jolt/Core/StreamIn.h>
#include <Jolt/Core/StreamOut.h>

#include <cstdint>
#include <cstring>
#include <vector>

namespace trillion {

class BlobOut final : public JPH::StreamOut {
public:
  std::vector<uint8_t> bytes;
  void WriteBytes(const void *data, size_t count) override {
    const uint8_t *from = static_cast<const uint8_t *>(data);
    bytes.insert(bytes.end(), from, from + count);
  }
  bool IsFailed() const override { return false; }
};

class BlobIn final : public JPH::StreamIn {
public:
  BlobIn(const uint8_t *data, size_t count) : data(data), count(count) {}
  void ReadBytes(void *out, size_t wanted) override {
    if (at + wanted > count) {
      failed = true;
      std::memset(out, 0, wanted);
      return;
    }
    std::memcpy(out, data + at, wanted);
    at += wanted;
  }
  bool IsEOF() const override { return at >= count; }
  bool IsFailed() const override { return failed; }

private:
  const uint8_t *data;
  size_t count, at = 0;
  bool failed = false;
};

}  // namespace trillion
