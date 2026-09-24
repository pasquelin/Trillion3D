# Builds Jolt Physics (pinned submodule `JoltPhysics/`) and this package's flat batched C API into
# one standalone WebAssembly module, `joltPhysics.wasm`. Driven by `scripts/build-physics-wasm.ts`;
# needs emscripten (`emcmake cmake`). No JavaScript glue is produced or kept: the engine's own
# loader (`packages/sdk-browser/src/physics/joltModule.ts`) instantiates the module.
cmake_minimum_required(VERSION 3.20)
project(PhysicsJoltWasm CXX)

set(CMAKE_CXX_STANDARD 17)
set(DOUBLE_PRECISION OFF CACHE BOOL "" FORCE)
set(USE_WASM_SIMD ON CACHE BOOL "" FORCE)
set(CPP_EXCEPTIONS_ENABLED OFF CACHE BOOL "" FORCE)
set(CPP_RTTI_ENABLED OFF CACHE BOOL "" FORCE)
set(ENABLE_ALL_WARNINGS OFF CACHE BOOL "" FORCE)
set(ENABLE_INSTALL OFF CACHE BOOL "" FORCE)
set(ENABLE_OBJECT_STREAM OFF CACHE BOOL "" FORCE)
set(GENERATE_DEBUG_SYMBOLS OFF CACHE BOOL "" FORCE)
set(DEBUG_RENDERER_IN_DEBUG_AND_RELEASE OFF CACHE BOOL "" FORCE)
set(PROFILER_IN_DEBUG_AND_RELEASE OFF CACHE BOOL "" FORCE)
set(FLOATING_POINT_EXCEPTIONS_ENABLED OFF CACHE BOOL "" FORCE)
set(INTERPROCEDURAL_OPTIMIZATION ON CACHE BOOL "" FORCE)
set(JPH_USE_DX12 OFF CACHE BOOL "" FORCE)
set(JPH_USE_VK OFF CACHE BOOL "" FORCE)
set(JPH_USE_MTL OFF CACHE BOOL "" FORCE)
set(JPH_USE_CPU_COMPUTE OFF CACHE BOOL "" FORCE)
add_subdirectory(JoltPhysics/Build Jolt)

add_executable(joltPhysics src/world.cpp src/commands.cpp src/report.cpp)
target_link_libraries(joltPhysics PRIVATE Jolt)
set_target_properties(joltPhysics PROPERTIES SUFFIX ".wasm")
target_compile_options(joltPhysics PRIVATE -O3 -msimd128)
target_link_options(joltPhysics PRIVATE
  -O3 -msimd128 --no-entry
  -sSTANDALONE_WASM=1 -sIMPORTED_MEMORY=1 -sALLOW_MEMORY_GROWTH=1
  -sINITIAL_MEMORY=33554432 -sMAXIMUM_MEMORY=4294967296 -sSTACK_SIZE=1048576
  -sFILESYSTEM=0 -sASSERTIONS=0 -sERROR_ON_UNDEFINED_SYMBOLS=1
  "-sEXPORTED_FUNCTIONS=['_jolt_init','_jolt_buffer','_jolt_step','_jolt_event_count','_jolt_error','_jolt_active_count','_malloc','_free']")
