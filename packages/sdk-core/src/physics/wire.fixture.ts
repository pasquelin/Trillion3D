// The command word counts the Jolt side reads, taken from its own source
// (`packages/physics-jolt-wasm/src/`): a test checks the writers against what the reader expects,
// never against a copy of it.
import { readFileSync } from 'node:fs';

/** The value of `name`, a `constexpr` of the Jolt binding's `file`. */
function joltConstant(file: string, name: string) {
  const url = new URL(`../../../physics-jolt-wasm/src/${file}`, import.meta.url);
  const found = readFileSync(url, 'utf8').match(new RegExp(`\\b${name} = (\\d+)`));
  if (!found) throw new Error(`${name} is not declared in ${file}`);
  return Number(found[1]);
}

/** Words of RESTORE before its bytes: `op, handle, byteCount`. */
export const RESTORE_WORDS = joltConstant('restore.h', 'RESTORE_WORDS');
/** Words of SOFT before its vertices. */
export const SOFT_WORDS = joltConstant('binding.h', 'SOFT_WORDS');
/** Words of VEHICLE before its wheels, of one wheel, and of DRIVE. */
export const VEHICLE_WORDS = joltConstant('binding.h', 'VEHICLE_WORDS');
export const WHEEL_WORDS = joltConstant('vehicles.cpp', 'WHEEL_WORDS');
export const DRIVE_WORDS = joltConstant('binding.h', 'DRIVE_WORDS');
