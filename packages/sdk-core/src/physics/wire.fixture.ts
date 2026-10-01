// The command word counts and error names the Jolt side reads, and the memory it starts with,
// taken from its own source (`packages/physics-jolt-wasm/`): a test checks the writers against
// what the reader expects, never against a copy of it.
import { readFileSync } from 'node:fs';

/** The text of the Jolt module's `file`, from its package. */
const jolt = (file: string) =>
  readFileSync(new URL(`../../../physics-jolt-wasm/${file}`, import.meta.url), 'utf8');
/** The text of the Jolt binding's `file`. */
const binding = (file: string) => jolt(`src/${file}`);

/** The value of `name`, a `constexpr` of the Jolt binding's `file`. */
function joltConstant(file: string, name: string) {
  const found = binding(file).match(new RegExp(`\\b${name} = (\\d+)`));
  if (!found) throw new Error(`${name} is not declared in ${file}`);
  return Number(found[1]);
}

/** The names of the binding's `enum name`, by the value each is given. */
export function joltEnum(file: string, name: string) {
  const found = binding(file).match(new RegExp(`enum ${name}\\b[^{]*\\{([^}]*)\\}`));
  if (!found) throw new Error(`enum ${name} is not declared in ${file}`);
  const names: string[] = [];
  for (const entry of found[1].split(','))
    names[Number(entry.split('=')[1])] = entry.split('=')[0].trim();
  return names;
}

/** Words of RESTORE before its bytes: `op, handle, byteCount`. */
export const RESTORE_WORDS = joltConstant('restore.h', 'RESTORE_WORDS');
/** Words of SOFT before its vertices. */
export const SOFT_WORDS = joltConstant('binding.h', 'SOFT_WORDS');
/** Words of VEHICLE before its wheels, of one wheel, and of DRIVE. */
export const VEHICLE_WORDS = joltConstant('binding.h', 'VEHICLE_WORDS');
export const WHEEL_WORDS = joltConstant('vehicles.cpp', 'WHEEL_WORDS');
export const DRIVE_WORDS = joltConstant('binding.h', 'DRIVE_WORDS');
/** Bytes of memory the module is built to start with: a budget below it cannot open it. */
export const MODULE_MEMORY = Number(jolt('CMakeLists.txt').match(/-sINITIAL_MEMORY=(\d+)/)![1]);
