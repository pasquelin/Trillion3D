// Flat, batched C API over Jolt Physics for the engine's physics worker. One `jolt_step` call per
// fixed step reads a command buffer and writes a pose buffer and an event buffer; no per-object
// wrapper crosses the boundary. The word layouts mirror `packages/sdk-core/src/physics/layout.ts`
// (PHYSICS_LAYOUT_VERSION): change both together.
#pragma once

#include <Jolt/Jolt.h>

#include <Jolt/Core/JobSystem.h>
#include <Jolt/Core/Mutex.h>
#include <Jolt/Core/TempAllocator.h>
#include <Jolt/Physics/Body/BodyActivationListener.h>
#include <Jolt/Physics/Collision/ContactListener.h>
#include <Jolt/Physics/PhysicsSystem.h>

#include <cstdint>
#include <unordered_map>
#include <vector>

namespace trillion {

/// Object layers: static geometry, moving bodies, decorative bodies (debris: they meet the static
/// world only).
enum Layer : JPH::ObjectLayer { STATIC = 0, MOVING = 1, DECORATIVE = 2, LAYER_COUNT = 3 };

/// Per-body flag bits carried by the ADD and FLAGS commands.
enum Flag : uint32_t { SENSOR = 1, CCD = 2, EVENTS = 4, HIDDEN = 8 };

/// Error codes returned by `jolt_error` after a failed `jolt_step` (mirrored in layout.ts).
enum Error : uint32_t { NONE = 0, BODY_LIMIT = 1, UNKNOWN_BODY = 2, BAD_SHAPE = 3, BAD_COMMAND = 4 };

/// A body's engine id: its slot in the low bits, the slot's generation above (layout.ts BODY_INDEX),
/// so a record naming a body that left is never read as the one that took its slot.
constexpr uint32_t INDEX_MASK = 0x00FFFFFFu;

struct Slot {
  JPH::BodyID id;
  /** The engine id the page gave the body (slot and generation). */
  uint32_t engine = 0;
  uint32_t flags = 0;
  /** The step whose pose buffer holds this body's record: one record per body and step. */
  uint32_t sent = 0;
  bool used = false;
  /** Its shape was refused: commands naming it are skipped until the page removes it. */
  bool refused = false;
  /** Listed in `World::waiting`. */
  bool waiting = false;
  /** A pose was withheld (out of view): it is sent once the body is seen again. */
  bool withheld = false;
  /** Deactivated beyond the range; its velocities are kept here and given back on return. */
  bool frozen = false;
  JPH::Vec3 linear = JPH::Vec3::sZero(), angular = JPH::Vec3::sZero();
};

/** The page's view (VIEW command): what is simulated (range) and what is sent (the cone). */
struct View {
  JPH::Vec3 eye = JPH::Vec3::sZero(), facing = JPH::Vec3(0, 0, -1);
  /** Half angle of the cone around `facing` that holds the frame; 0 sees everything. */
  float halfCone = 0;
  /** Beyond this distance, bodies are frozen; 0 is no range. */
  float range = 0;
};

class Listener final : public JPH::ContactListener, public JPH::BodyActivationListener {
public:
  void OnContactAdded(const JPH::Body &a, const JPH::Body &b, const JPH::ContactManifold &manifold,
                      JPH::ContactSettings &settings) override;
  void OnContactRemoved(const JPH::SubShapeIDPair &pair) override;
  void OnBodyActivated(const JPH::BodyID &, JPH::uint64) override {}
  void OnBodyDeactivated(const JPH::BodyID &id, JPH::uint64 user) override;

private:
  /// Jolt calls these from its jobs, on every thread of the pool at once.
  JPH::Mutex lock;
};

struct World {
  JPH::TempAllocator *temp = nullptr;
  JPH::JobSystem *jobs = nullptr;
  JPH::PhysicsSystem *system = nullptr;
  Listener listener;
  std::vector<Slot> slots;
  /// Jolt body index -> engine id, so a contact's removal names the bodies it was reported with.
  std::vector<uint32_t> engineOf;
  /** Engine ids of the bodies Jolt put to sleep during the step. */
  std::vector<uint32_t> deactivated;
  /** Bodies whose pose is withheld while asleep, or frozen: examined again every step. */
  std::vector<uint32_t> waiting;
  View view;
  /** Touching pairs by engine ids: sub-shape contacts counted, `ENTERED` once the page was told. */
  std::unordered_map<uint64_t, uint32_t> pairs;
  /** Leaves that found the event buffer full: written first at the next step, never lost. */
  std::vector<uint64_t> leaving;
  /** This step's bodies whose shape was refused (engine ids), and its enters the buffer dropped. */
  std::vector<uint32_t> refused;
  uint32_t dropped = 0;
  std::unordered_map<uint64_t, JPH::RefConst<JPH::Shape>> primitives;
  uint32_t *buffers[3] = {nullptr, nullptr, nullptr};
  uint32_t capacity[3] = {0, 0, 0};
  uint32_t eventWords = 0;
  uint32_t error = NONE;
  /** What the last `PhysicsSystem::Update` could not hold (`EPhysicsUpdateError` bits). */
  uint32_t updateError = 0;
  uint32_t step = 0;
  float dt = 0;
};

World &world();

/// Word counts of one pose and one event record (layout.ts POSE_WORDS / EVENT_WORDS).
constexpr uint32_t POSE_WORDS = 14;
constexpr uint32_t EVENT_WORDS = 7;

/// Executes `words` command words; returns false (with `world().error` set) on the first failure.
bool runCommands(const uint32_t *words, uint32_t count);
/// The page's leave for every pair a body being removed was in; its later removal is ignored.
void leaveAll(uint32_t engine);
/// The shape an ADD command (`w`, from its opcode) describes, or null when refused.
JPH::RefConst<JPH::Shape> shapeOf(const uint32_t *w);
/// Writes the leaves a full event buffer held back at the last step, before anything else.
void sendOwedLeaves();
/// Runs the BUOYANCY command at `w` (`buoyancy.cpp`); returns its word count.
uint32_t runBuoyancy(const uint32_t *w);
/// Writes the poses of the dynamic bodies that moved during the step; returns their count.
uint32_t writePoses();

/// The character's commands and state (`character.cpp`, layout.ts).
constexpr uint32_t CHARACTER = 13, CHARACTER_MOVE = 14;
constexpr uint32_t CHARACTER_WORDS = 10, CHARACTER_MOVE_WORDS = 5, CHARACTER_STATE_WORDS = 9;
/// Runs one character command; returns its word count.
uint32_t characterCommand(const uint32_t *w);
/// Moves the character by the velocity this step's CHARACTER_MOVE asked for, before the bodies.
void moveCharacter(float dt);
/// Writes the character's state once the bodies have stepped.
void writeCharacter();

/// The joints' commands (`joints.cpp`, layout.ts JOINT_WORDS).
constexpr uint32_t JOINT = 18, UNJOINT = 19, MOTOR = 20;
constexpr uint32_t JOINT_WORDS = 31, UNJOINT_WORDS = 2, MOTOR_WORDS = 5;
/// Runs one joint command; returns its word count.
uint32_t jointCommand(const uint32_t *w);
/// Takes out the joints of the body in slot `index`, before the body is removed.
void dropJoints(uint32_t index);
/// After a step of `dt` seconds, takes out the joints pulled past their break force.
void breakJoints(float dt);

}  // namespace trillion
