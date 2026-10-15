// The world's joints: Jolt's own two-body constraints (built by `jointSettings.cpp`, driven and
// weighed by `jointMotors.cpp`) between two bodies or a body and the world, with their limits,
// limit springs and motors. A joint past its break force is taken out after the step and
// reported. Word layouts: layout.ts (JOINT, UNJOINT, MOTOR).
#include "binding.h"
#include "joints.h"
#include "jointIndex.h"
#include "words.h"

#include <algorithm>
#include <cmath>

using namespace JPH;

namespace trillion {

namespace {

struct Joint {
  Ref<TwoBodyConstraint> constraint;
  /** The page's joint id (slot and generation), and the body slots it connects. */
  uint32_t id = 0, a = MISS, b = MISS, kind = 0;
  /** Newtons of pull past which it breaks; 0 never. */
  float breakForce = 0;
  /** Its axis on `a` and on `b`, in each body's frame: what matches a gear to its wheels' hinges. */
  Vec3 axisA = Vec3::sZero(), axisB = Vec3::sZero();
  /** A gear's or a rack and pinion's body order and phase correction. */
  GearOrder order;
  /** A path's fraction where its body stood when the step began (`carryAlongPath`). */
  float along = 0;
};

std::vector<Joint> joints;
/** Each joint under its body ends (the world's none), and every path and breakable joint: what
 *  `link`, `dropJoints`, the step's path carry and its breaking walk. */
JointIndex ends;
/** This step's broken joints, by id. */
std::vector<uint32_t> broken;
/** The joints `link` has visited since the module started: a diagnostic, read by the tests only
 *  (`jolt_link_visits`), so its cost is counted, never timed. */
uint32_t linkVisits = 0;
/** The path joints the step's carry, and the joints its breaking, have visited since the module
 *  started: diagnostics, read by the tests only (`jolt_path_visits`, `jolt_break_visits`). */
uint32_t pathVisits = 0, breakVisits = 0;

/// A body's frame from the words (`point, axis, normal` in its own frame), its point moved from
/// the body's origin to its centre of mass (Jolt's `LocalToBodyCOM`); the world's frame as given.
Frame frameOf(const uint32_t *w, uint32_t engine) {
  Vec3 point = vec3(w);
  if (engine != MISS) {
    const Slot &slot = world().slots[engine & INDEX_MASK];
    point -= world().system->GetBodyInterfaceNoLock().GetShape(slot.id)->GetCenterOfMass();
  }
  return {point, vec3(w + 3).NormalizedOr(Vec3::sAxisY()), vec3(w + 6).NormalizedOr(Vec3::sAxisX())};
}

/// The body a joint end names, or the world when it names none (`BodyID()`); false when the slot
/// holds no body (refused, or removed since): the joint is not made.
bool bodyOf(uint32_t engine, BodyID &id) {
  if (engine == MISS) return (id = BodyID(), true);
  uint32_t index = engine & INDEX_MASK;
  const std::vector<Slot> &slots = world().slots;
  if (index >= slots.size() || !slots[index].used || slots[index].engine != engine || slots[index].soft)
    return false;
  return (id = slots[index].id, true);
}

/// Drives the joint by its motor: off, to a velocity or to a position, with at most `maxForce`
/// (N·m or N; 0 is no bound); woken when its kind has one (`driveJoint`).
void drive(Joint &joint, uint32_t mode, float target, float maxForce, uint32_t axis) {
  float limit = maxForce > 0 && std::isfinite(maxForce) ? maxForce : FLT_MAX;
  EMotorState state = mode == MOTOR_VELOCITY ? EMotorState::Velocity : mode == MOTOR_POSITION ? EMotorState::Position : EMotorState::Off;
  if (driveJoint(joint.constraint.GetPtr(), joint.kind, state, target, limit, axis))
    world().system->GetBodyInterfaceNoLock().ActivateConstraint(joint.constraint);
}

/// The hinge or slider (`kind`) that holds the body in `slot` as its `a`, about `axis` in that
/// body's frame — of several, the one in the lowest joint slot; null when none does.
const Constraint *holder(uint32_t kind, uint32_t slot, Vec3 axis) {
  uint32_t first = UINT32_MAX;
  for (uint32_t i : ends.at(slot)) {
    ++linkVisits;
    const Joint &joint = joints[i];
    if (joint.kind == kind && i < first && joint.a == slot && joint.axisA.Dot(axis) > 0.999f) first = i;
  }
  return first == UINT32_MAX ? nullptr : joints[first].constraint.GetPtr();
}

/// Hands a gear its wheels' hinges, or a rack and pinion its pinion's hinge and its rack's
/// slider, those that hold the body as their `a` about the same axis, so Jolt keeps the teeth in
/// the phase they were made in; none when one is missing.
void link(Joint &joint) {
  if (!joint.order.inPhase) return;
  ++linkVisits;
  const Constraint *onA = holder(HINGE, joint.a, joint.axisA);
  const Constraint *onB = holder(joint.kind == GEAR ? HINGE : SLIDER, joint.b, joint.axisB);
  if (!onA || !onB) onA = onB = nullptr;
  bool aFirst = joint.order.aFirst;
  linkGear(joint.constraint, joint.kind, aFirst ? onA : onB, aFirst ? onB : onA);
}

/// Relinks the gears and racks on a hinge's or a slider's `a` body, once it is made or taken out:
/// none keeps one gone. Other kinds hold no gear.
void relinkGearsOn(const Joint &joint) {
  if (joint.kind != HINGE && joint.kind != SLIDER) return;
  for (uint32_t i : ends.at(joint.a))
    if (joints[i].kind == GEAR || joints[i].kind == RACK_AND_PINION) link(joints[i]);
}

/// Files the joint at `index` under its body ends, among the paths if it is one and among the
/// breakable joints if a finite force breaks it; or takes it out.
void file(uint32_t index, bool in) {
  const Joint &joint = joints[index];
  for (uint32_t slot : {joint.a, joint.b})
    if (slot != MISS) in ? ends.add(slot, index) : ends.remove(slot, index);
  if (joint.kind == PATH) ends.mark(JointIndex::PATHS, index, in);
  if (joint.breakForce > 0 && std::isfinite(joint.breakForce)) ends.mark(JointIndex::BREAKABLE, index, in);
}

/// Takes out the joint at `index`, if any, and relinks the gears it held.
void take(uint32_t index) {
  Joint &joint = joints[index];
  if (!joint.constraint) return;
  file(index, false);
  world().system->RemoveConstraint(joint.constraint);
  Joint gone = joint;
  joint = Joint();
  relinkGearsOn(gone);
}

void add(const uint32_t *w) {
  uint32_t id = w[1], index = id & INDEX_MASK, kind = w[2];
  if (index >= joints.size()) joints.resize(index + 1);
  take(index);
  BodyID a, b;
  // A body refused or gone since the page wrote the joint: the page removes the joint in turn.
  if (kind > RACK_AND_PINION || !bodyOf(w[3], a) || !bodyOf(w[4], b) || a == b) return;
  // `b` is Jolt's first body, `a` its second: a motor, a limit and a slide measure `a` from `b`
  // (from the world when `b` names none), and Jolt solves the turn from the steadier side. A rack
  // and pinion, and some gears, Jolt makes `a` first (`gearOrder`).
  Frame f1 = frameOf(w + 17, w[4]), f2 = frameOf(w + 8, w[3]);
  GearOrder order = gearOrder(kind, w + JOINT_WORDS, w[7]);
  Ref<TwoBodyConstraintSettings> settings = jointSettings(kind, f1, f2, w + 26, w + JOINT_WORDS, w[7], vec3(w + 17), order);
  if (!settings) return;
  BodyInterface &bodies = world().system->GetBodyInterfaceNoLock();
  Joint &joint = joints[index];
  joint.order = order;
  joint.constraint = joint.order.aFirst ? bodies.CreateConstraint(settings, a, b) : bodies.CreateConstraint(settings, b, a);
  joint.id = id, joint.kind = kind, joint.breakForce = f32(w + 32);
  joint.axisA = f2.axis, joint.axisB = f1.axis;
  joint.a = w[3] == MISS ? MISS : w[3] & INDEX_MASK;
  joint.b = w[4] == MISS ? MISS : w[4] & INDEX_MASK;
  world().system->AddConstraint(joint.constraint);
  bodies.ActivateConstraint(joint.constraint);
  drive(joint, w[5], f32(w + 30), f32(w + 31), w[6]);
  file(index, true);
  if (kind == GEAR || kind == RACK_AND_PINION) link(joint);
  else relinkGearsOn(joint);
}

}  // namespace

uint32_t jointCommand(const uint32_t *w) {
  uint32_t index = w[1] & INDEX_MASK;
  // A command naming a joint that broke, or never was made, is dropped.
  Joint *joint = index < joints.size() && joints[index].constraint && joints[index].id == w[1] ? &joints[index] : nullptr;
  if (w[0] == JOINT) {
    add(w);
    return JOINT_WORDS + w[7];
  }
  if (w[0] == UNJOINT) {
    if (joint) take(index);
    return UNJOINT_WORDS;
  }
  if (joint) drive(*joint, w[2], f32(w + 4), f32(w + 5), w[3]);
  return MOTOR_WORDS;
}

void dropJoints(uint32_t index) {
  // A copy, since taking a joint out changes the list; in joint order, the same every run.
  std::vector<uint32_t> held = ends.at(index);
  std::sort(held.begin(), held.end());
  for (uint32_t i : held) take(i);
}

void notePaths() {
  for (uint32_t i : ends.every(JointIndex::PATHS)) joints[i].along = pathFraction(joints[i].constraint);
}

void carryPaths() {
  const std::vector<uint32_t> &paths = ends.every(JointIndex::PATHS);
  pathVisits += uint32_t(paths.size());
  for (uint32_t i : paths) carryAlongPath(joints[i].constraint, joints[i].along);
}

void breakJoints(float dt) {
  broken.clear();
  if (dt <= 0) return;
  const std::vector<uint32_t> &breakable = ends.every(JointIndex::BREAKABLE);
  breakVisits += uint32_t(breakable.size());
  // Taking a joint out changes the list: the broken are found first, then taken in slot order.
  std::vector<uint32_t> gone;
  for (uint32_t i : breakable)
    if (jointPull(joints[i].constraint, joints[i].kind) > joints[i].breakForce * dt) gone.push_back(i);
  std::sort(gone.begin(), gone.end());
  for (uint32_t i : gone) {
    broken.push_back(joints[i].id);
    take(i);
  }
}

}  // namespace trillion

extern "C" {

/// The joints the last step broke: their count, then each joint id.
uint32_t jolt_broken_count() { return uint32_t(trillion::broken.size()); }
uint32_t jolt_broken(uint32_t i) { return trillion::broken[i]; }
/// The joints the gear linking has visited since the module started: the tests' measure of its cost.
uint32_t jolt_link_visits() { return trillion::linkVisits; }
/// The path joints the step's carry has visited since the module started: the tests' measure of its cost.
uint32_t jolt_path_visits() { return trillion::pathVisits; }
/// The breakable joints the step's breaking has visited since the module started: likewise.
uint32_t jolt_break_visits() { return trillion::breakVisits; }

}  // extern "C"
