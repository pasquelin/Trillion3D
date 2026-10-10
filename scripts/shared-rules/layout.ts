// The physics word layouts printed (`../generate-shared-rules.ts`): the opcodes, the error codes
// and the word counts of the command, pose and event buffers, into the physics module's C++ header.
import * as layout from '../../packages/sdk-core/src/physics/layout.ts'
import * as soft from '../../packages/sdk-core/src/physics/softLayout.ts'
import * as vehicle from '../../packages/sdk-core/src/physics/vehicleLayout.ts'
import { header } from './statements.ts'

const SOURCES = [
  'packages/sdk-core/src/physics/layout.ts',
  'packages/sdk-core/src/physics/softLayout.ts',
  'packages/sdk-core/src/physics/vehicleLayout.ts',
]

/** `camelCase` as the module names it, `CAMEL_CASE`. */
const upper = (name: string) => name.replace(/[A-Z]/g, '_$&').toUpperCase()

/** The module's layout header: `Op` and `Error` with the numbers the page writes and reads, then
 *  each word count and size the layouts export. */
export function physicsLayoutHeader() {
  const counts = Object.entries({ ...layout, ...soft, ...vehicle })
    .filter(([name]) => /_WORDS$|^(TORQUE_POINTS|MAX_GEARS)$/.test(name))
    .map(([name, value]) => `constexpr uint32_t ${name} = ${value};`)
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

/// A query's miss and the id of no body (layout.ts MISS).
constexpr uint32_t MISS = ${layout.MISS}u;

/// Words of each command, record and table, and the vehicle tables' sizes (layout.ts,
/// softLayout.ts, vehicleLayout.ts).
${counts.join('\n')}

}  // namespace trillion
`
}
