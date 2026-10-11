// The physics word layouts printed (`../generate-shared-rules.ts`): the opcodes, the error codes
// and the word counts of the command, pose and event buffers, into the physics module's C++ header.
import * as layout from '../../packages/sdk-core/src/physics/layout.ts'
import {
  SOFT_STATE_WORDS,
  SOFT_VERTEX_WORDS,
  SOFT_WORDS,
} from '../../packages/sdk-core/src/physics/softLayout.ts'
import {
  DRIVE_WORDS,
  MAX_GEARS,
  TORQUE_POINTS,
  UNVEHICLE_WORDS,
  VEHICLE_STATE_WORDS,
  VEHICLE_WORDS,
  WHEEL_STATE_WORDS,
  WHEEL_WORDS,
} from '../../packages/sdk-core/src/physics/vehicleLayout.ts'
import { header } from './statements.ts'

const SOURCES = [
  'packages/sdk-core/src/physics/layout.ts',
  'packages/sdk-core/src/physics/softLayout.ts',
  'packages/sdk-core/src/physics/vehicleLayout.ts',
]

/** Every word count and table size of the layouts, by the name the module reads it under. */
const COUNTS = {
  ADD_WORDS: layout.ADD_WORDS,
  PART_WORDS: layout.PART_WORDS,
  CAST_WORDS: layout.CAST_WORDS,
  HIT_WORDS: layout.HIT_WORDS,
  RESTORE_WORDS: layout.RESTORE_WORDS,
  RELEASE_WORDS: layout.RELEASE_WORDS,
  JOINT_WORDS: layout.JOINT_WORDS,
  UNJOINT_WORDS: layout.UNJOINT_WORDS,
  MOTOR_WORDS: layout.MOTOR_WORDS,
  VIEW_WORDS: layout.VIEW_WORDS,
  WATER_PIECE_WORDS: layout.WATER_PIECE_WORDS,
  BUOYANCY_WORDS: layout.BUOYANCY_WORDS,
  PLANE_WORDS: layout.PLANE_WORDS,
  POSE_WORDS: layout.POSE_WORDS,
  EVENT_WORDS: layout.EVENT_WORDS,
  CHARACTER_WORDS: layout.CHARACTER_WORDS,
  CHARACTER_MOVE_WORDS: layout.CHARACTER_MOVE_WORDS,
  CHARACTER_STATE_WORDS: layout.CHARACTER_STATE_WORDS,
  SOFT_WORDS,
  SOFT_VERTEX_WORDS,
  SOFT_STATE_WORDS,
  VEHICLE_WORDS,
  WHEEL_WORDS,
  UNVEHICLE_WORDS,
  DRIVE_WORDS,
  VEHICLE_STATE_WORDS,
  WHEEL_STATE_WORDS,
  TORQUE_POINTS,
  MAX_GEARS,
}

/** `camelCase` as the module names it, `CAMEL_CASE`. */
const upper = (name: string) => name.replace(/[A-Z]/g, '_$&').toUpperCase()

/** The module's layout header: `Op` and `Error` with the numbers the page writes and reads, then
 *  each word count and size the layouts export. */
export function physicsLayoutHeader() {
  const counts = Object.entries(COUNTS).map(
    ([name, value]) => `constexpr uint32_t ${name} = ${value};`,
  )
  const named = (group: Record<string, number>, prefix = '') =>
    Object.entries(group).map(([name, value]) => `${prefix}${upper(name)} = ${value}`)
  const ops = named(layout.OP)
  const errors = layout.MODULE_ERROR.map((name, code) => `${name} = ${code}`)
  return `${header(SOURCES, '//')}
#pragma once

#include <cstdint>

namespace trillion {

/// Command opcodes, the first word of each command (layout.ts OP).
enum Op : uint32_t { ${ops.join(', ')} };

/// Shape kinds of the ADD command (layout.ts SHAPE).
enum ShapeKind : uint32_t { ${named(layout.SHAPE).join(', ')} };

/// Per-body flag bits carried by the ADD and FLAGS commands; ASLEEP, by ADD alone, adds it asleep
/// (layout.ts FLAG).
enum Flag : uint32_t { ${named(layout.FLAG).join(', ')} };

/// Joint kinds of the JOINT command (layout.ts JOINT).
enum JointKind : uint32_t { ${named(layout.JOINT).join(', ')} };

/// What a joint's motor does (layout.ts MOTOR).
enum MotorMode : uint32_t { ${named(layout.MOTOR, 'MOTOR_').join(', ')} };

/// Event types: a pair of bodies started touching, or stopped (layout.ts EVENT).
enum EventType : uint32_t { ${Object.entries(layout.EVENT)
    .map(([name, value]) => `EVENT_${upper(name)} = ${value}`)
    .join(', ')} };

/// Set on a pose record's index word when the body fell asleep during the step (layout.ts).
constexpr uint32_t ASLEEP_BIT = ${layout.ASLEEP_BIT}u;

/// Error codes returned by \`jolt_error\` after a failed \`jolt_step\` (layout.ts MODULE_ERROR).
enum Error : uint32_t { ${errors.join(', ')} };

/// A body's engine id: its slot in the low bits, the slot's generation above (layout.ts BODY_INDEX),
/// so a record naming a body that left is never read as the one that took its slot.
constexpr uint32_t INDEX_MASK = ${layout.BODY_INDEX}u;

/// A query's miss and the id of no body (layout.ts MISS).
constexpr uint32_t MISS = ${layout.MISS}u;

/// Words of each command, record and table, and the vehicle tables' sizes (layout.ts,
/// softLayout.ts, vehicleLayout.ts).
${counts.join('\n')}

}  // namespace trillion
`
}
