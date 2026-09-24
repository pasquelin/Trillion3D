// The threaded module's one entry point of its own: where a thread it started keeps its stack. The
// loader (`packages/sdk-browser/src/physics/joltThreads.ts`) sets a new worker's stack pointer and
// limits from it before that worker runs any other code of the module.
#include <pthread.h>

#include <cstdint>

extern "C" uintptr_t jolt_thread_stack(pthread_t thread, uint32_t top) {
  pthread_attr_t attr;
  void *low = nullptr;
  size_t size = 0;
  pthread_getattr_np(thread, &attr);
  pthread_attr_getstack(&attr, &low, &size);
  pthread_attr_destroy(&attr);
  return top ? uintptr_t(low) + size : uintptr_t(low);
}
