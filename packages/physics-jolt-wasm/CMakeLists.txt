# Builds Jolt Physics (pinned submodule `JoltPhysics/`) and this package's flat batched C API into
# one standalone WebAssembly module: `joltPhysics.wasm`, or with `-DTHREADS=ON`
# `joltPhysicsThreads.wasm` (atomics, bulk memory, shared memory, Jolt's thread pool). Driven by `scripts/build-physics-wasm.ts`;
# needs emscripten (`emcmake cmake`). No JavaScript glue is produced or kept: the engine's own
# loader (`packages/sdk-browser/src/physics/joltModule.ts`) instantiates the module.
cmake_minimum_required(VERSION 3.20)
project(PhysicsJoltWasm CXX)

set(CMAKE_CXX_STANDARD 17)
option(THREADS "Build the threaded module (shared memory, Jolt's thread pool)" OFF)
# The bench's per-phase profile (`bench/profile.cpp`): never in a shipped module.
option(PROFILE "Time Jolt's profiled scopes, for the bench" OFF)
# The compiler's native cook (`cook/cook.cpp`), linked by `packages/asset-compiler-rust/build.rs`:
# plain objects (no link-time bitcode), position independent, same Jolt settings as the web module.
option(COOK "Build the native cook library for the compiler" OFF)
if (PROFILE)
  set(PROFILER_IN_DISTRIBUTION ON CACHE BOOL "" FORCE)
  set(JPH_USE_EXTERNAL_PROFILE ON CACHE BOOL "" FORCE)
  set(PROFILE_SOURCES bench/profile.cpp)
  set(PROFILE_EXPORTS ",'_jolt_profile_name','_jolt_profile_ms','_jolt_profile_calls','_jolt_profile_reset'")
endif ()
if (THREADS)
  # Every object, Jolt's included, must carry the atomics and bulk-memory features.
  add_compile_options(-pthread)
  set(NAME joltPhysicsThreads)
  set(SOURCES src/thread.cpp)
  set(THREAD_OPTIONS -pthread)
  set(THREAD_EXPORTS ",'_jolt_thread_stack'")
else ()
  set(NAME joltPhysics)
endif ()
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
if (COOK)
  set(INTERPROCEDURAL_OPTIMIZATION OFF CACHE BOOL "" FORCE)
  set(CMAKE_POSITION_INDEPENDENT_CODE ON)
else ()
  set(INTERPROCEDURAL_OPTIMIZATION ON CACHE BOOL "" FORCE)
endif ()
set(JPH_USE_DX12 OFF CACHE BOOL "" FORCE)
set(JPH_USE_VK OFF CACHE BOOL "" FORCE)
set(JPH_USE_MTL OFF CACHE BOOL "" FORCE)
set(JPH_USE_CPU_COMPUTE OFF CACHE BOOL "" FORCE)
add_subdirectory(JoltPhysics/Build Jolt)

if (COOK)
  add_library(joltCook STATIC cook/cook.cpp)
  target_link_libraries(joltCook PUBLIC Jolt)
  return()
endif ()
if (NOT EMSCRIPTEN)
  # The native bench (`bench/native.cpp`), for comparison with the web module; never shipped.
  add_executable(joltBench bench/native.cpp src/world.cpp src/contacts.cpp src/commands.cpp src/shapes.cpp src/report.cpp src/restore.cpp src/character.cpp
    src/buoyancy.cpp src/joints.cpp src/advancedJoints.cpp src/pathCarry.cpp src/vehicles.cpp
    ${PROFILE_SOURCES})
  target_link_libraries(joltBench PRIVATE Jolt)
  target_compile_options(joltBench PRIVATE -O3)
  # Its buoyancy share (`bench/water.cpp`, `scripts/bench-fluids.ts`).
  add_executable(joltWaterBench bench/water.cpp src/world.cpp src/contacts.cpp src/commands.cpp src/shapes.cpp
    src/report.cpp src/restore.cpp src/character.cpp src/buoyancy.cpp src/joints.cpp src/advancedJoints.cpp src/pathCarry.cpp src/vehicles.cpp)
  target_link_libraries(joltWaterBench PRIVATE Jolt)
  target_compile_options(joltWaterBench PRIVATE -O3)
  return()
endif ()

add_executable(${NAME} src/world.cpp src/contacts.cpp src/commands.cpp src/shapes.cpp src/report.cpp src/restore.cpp src/character.cpp
  src/buoyancy.cpp src/joints.cpp src/advancedJoints.cpp src/pathCarry.cpp src/vehicles.cpp ${SOURCES} ${PROFILE_SOURCES})
target_link_libraries(${NAME} PRIVATE Jolt)
set_target_properties(${NAME} PROPERTIES SUFFIX ".wasm")
target_compile_options(${NAME} PRIVATE -O3 -msimd128)
target_link_options(${NAME} PRIVATE
  -O3 -msimd128 --no-entry ${THREAD_OPTIONS}
  -sSTANDALONE_WASM=1 -sIMPORTED_MEMORY=1 -sALLOW_MEMORY_GROWTH=1
  -sINITIAL_MEMORY=33554432 -sMAXIMUM_MEMORY=4294967296 -sSTACK_SIZE=1048576
  -sFILESYSTEM=0 -sASSERTIONS=0 -sERROR_ON_UNDEFINED_SYMBOLS=1
  "-sEXPORTED_FUNCTIONS=['_jolt_init','_jolt_buffer','_jolt_step','_jolt_event_count','_jolt_dropped_events','_jolt_update_error','_jolt_refused_count','_jolt_refused','_jolt_error','_jolt_active_count','_jolt_owed_leaves','_jolt_cast_buffer','_jolt_cast','_jolt_character','_jolt_water_query','_jolt_water_pieces','_jolt_broken_count','_jolt_broken','_jolt_link_visits','_jolt_vehicles','_jolt_vehicle_words'${THREAD_EXPORTS}${PROFILE_EXPORTS}]")
