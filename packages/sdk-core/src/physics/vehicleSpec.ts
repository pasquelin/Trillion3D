/**
 * THE VEHICLES A BODY STARTS AS: three real machines, every number read from them or declared as
 * a game's choice, never tuned on a scene. The engine's torque is given per kilogram of the body
 * and the brakes' from its weight, so a body of any mass drives as the machine does. The tyre slip
 * curves and the wheels' inertia are Jolt's own defaults.
 *
 * - CAR, a Chevrolet Corvette C5 (1997–2004), rear-wheel drive: LS1 engine, 475 N·m peak at 4,400
 *   rpm of a 6,000 rpm redline, peak power at 5,600 rpm, idling at 700 rpm; 1,470 kg at the kerb,
 *   so 0.32 N·m per kilogram. Its torque stays within 80 % of the peak from idle to the redline
 *   (the LS1's published dyno curve). Tremec T-56 six-speed: 2.66, 1.78, 1.30, 1.00, 0.74, 0.50,
 *   reverse 2.90, final drive 3.42.
 * - MOTORCYCLE, a Yamaha XJ900 (the machine Jolt's own motorcycle sample is drawn from): 84 N·m
 *   at 7,000 rpm of a 9,500 rpm redline, peak power at 9,000, idling at 1,100; 239 kg dry and a
 *   rider of 80 kg (`HUMAN_BODY.mass`), so 0.26 N·m per kilogram. Six-speed ratios, primary and
 *   final drive (1.93 × 40 / 16) as Jolt's sample reads them from the bike's gear table.
 * - TRACKED, an M1 Abrams: an AGT1500 gas turbine, 5,090 N·m for 61.3 t, so 0.083 N·m per
 *   kilogram; a free turbine's torque is highest at stall and about halves by its rated speed.
 *   Four forward gears and the track's final drive of 6, as Jolt's own tracked controller
 *   estimates them from the Abrams.
 * - ENGINE inertia: Jolt's own engine is 0.5 kg·m² for 500 N·m; an engine's rotating mass, and
 *   the friction its damping stands for, grow with its size, so the inertia is scaled by the
 *   engine's torque. Left at 0.5, a motorcycle's damping alone ate half its torque.
 * - SHIFTS: an automatic gearbox at full throttle shifts up at the engine's peak power, or at 90 %
 *   of the redline when the power peaks there (the turbine), since the governor stops the engine
 *   at it; and down below the speed the largest ratio step lands at, less a tenth, so a shift
 *   never hunts back. Jolt shifts up only while no driven wheel spins.
 * - CLUTCH, Jolt's own sample values: 10 for the car and the tracked hull, 2 for the motorcycle.
 * - SUSPENSION: ride frequencies of 1.5 Hz for a sports car, 2 Hz for a motorcycle, 1 Hz for a
 *   heavy tracked hull; a damping ratio of 0.5, between ride comfort's 0.25 and the 0.7 of a race
 *   car (Milliken and Milliken, "Race Car Vehicle Dynamics", 1995). Wheel travel 0.2 m for a car
 *   (150 to 250 mm), 0.13 m for a motorcycle's fork, 0.3 m for a tracked hull's torsion bars.
 *   Jolt makes each spring as stiff as its frequency asks of the body's mass felt at that wheel,
 *   and the suspension is hung so that under the body's weight each wheel rests where the page
 *   placed it.
 * - ANTI-ROLL 0.3, a game's choice, declared: a road car's bars range from a third of its axle's
 *   spring stiffness to twice it (Gillespie, "Fundamentals of Vehicle Dynamics", 1992). Jolt
 *   applies a bar's force a step late, and at 60 Hz a bar as stiff as its springs rocks a body
 *   with a box's roll inertia over; a third holds it.
 * - STEERING: a road car turns in a 10 to 12 m kerb-to-kerb circle, a radius of 5.5 m; a road
 *   motorcycle's full lock fits a 5.5 m circle too. The steered wheels' lock is the angle that
 *   radius asks of the vehicle's own wheelbase, `asin(wheelbase / radius)`. A hand turns the wheel
 *   from centre to lock in 0.25 s (a step steer ramps in 0.1 to 0.2 s, ISO 7401); keys are all or
 *   nothing, and a motorcycle steered at once falls.
 * - BRAKES: a road vehicle's brakes lock its wheels on dry asphalt, whose peak friction is about 1
 *   (0.8 to 1.0): each wheel brakes with the torque that locks it under its share of the weight,
 *   on Earth. The handbrake holds the rear wheels with twice that: it locks them outright.
 * - LEAN 45°: what a road tyre's shoulder allows a street motorcycle (45 to 50°). Jolt's lean
 *   controller rights the body at its own sample's natural frequency and damping ratio (12.5
 *   rad/s, 1.25), whatever the body's roll inertia.
 * - TRACKS grip their ground with a friction of 1 along and 0.5 across, the tractive and lateral
 *   resistance coefficients of a track on firm ground (Wong, "Theory of Ground Vehicles"); a
 *   track and its road wheels weigh a twentieth of the vehicle, turning at the sprocket's radius.
 * - TRACK TURN 0.6, a game's choice, declared (Jolt's tank sample): steering slows the inner track
 *   to 0.6 of the outer; below 1 m/s the tracks turn opposite ways, a pivot turn.
 */
export interface VehicleSpec {
  /** Engine peak torque per kilogram of the body, N·m/kg. */ torquePerKg: number;
  /** The engine's idle, rpm. */ idleRPM: number;
  /** The engine's redline, rpm. */ maxRPM: number;
  /** Up to five points `[rpm / maxRPM, torque / peak]`, rpm fractions rising. */
  torqueCurve: readonly (readonly [number, number])[];
  /** Up to six forward gear ratios, first gear first. */ gears: readonly number[];
  /** The reverse gear's ratio. */ reverse: number;
  /** The final drive's ratio (a tracked vehicle's sprocket reduction). */ finalDrive: number;
  /** The gearbox shifts up past this, rpm. */ shiftUpRPM: number;
  /** And down below this, rpm. */ shiftDownRPM: number;
  /** Clutch torque per rad/s of slip, N·m·s. */ clutch: number;
  /** Ride frequency, Hz. */ suspensionFrequency: number;
  /** Damping ratio, 0 (none) to 1 (critical). */ suspensionDamping: number;
  /** Wheel travel from full droop to full bump, m. */ suspensionTravel: number;
  /** Each anti-roll bar's stiffness over its axle's spring stiffness; 0 is none. */
  antiRoll: number;
  /** The full-lock turning radius, m. */ turnRadius: number;
  /** Seconds from centre to full lock. */ steerTime: number;
  /** The friction the brakes lock the wheels at. */ brakeGrip: number;
  /** A car's driven wheels. */ drive: 'front' | 'rear' | 'all';
  /** A tracked vehicle's inner track speed while steering, over the outer's. */ trackTurn: number;
  /** A motorcycle's greatest lean, radians. */ maxLean: number;
}

const GRAVITY = 9.80665;
/** The shift points of a gearbox (see SHIFTS). */
function shifts(peakPowerRPM: number, maxRPM: number, gears: readonly number[]) {
  const up = Math.min(peakPowerRPM, 0.9 * maxRPM);
  const step = Math.min(...gears.slice(1).map((ratio, i) => ratio / gears[i]));
  return { shiftUpRPM: up, shiftDownRPM: up * step * 0.9 };
}
/** The sag of a spring of frequency `f` under its own weight, m (see SUSPENSION). */
export const sagOf = (frequency: number) => GRAVITY / (2 * Math.PI * frequency) ** 2;

const COMMON = {
  suspensionDamping: 0.5,
  antiRoll: 0.3,
  turnRadius: 5.5,
  steerTime: 0.25,
  brakeGrip: 1,
  drive: 'rear',
  trackTurn: 0.6,
  maxLean: (45 * Math.PI) / 180,
  clutch: 10,
} as const;

const CAR_GEARS = [2.66, 1.78, 1.3, 1.0, 0.74, 0.5];
const BIKE_GEARS = [2.27, 1.63, 1.3, 1.09, 0.96, 0.88];
const TRACK_GEARS = [4, 3, 2, 1];

/** The three machines a vehicle starts as, by kind. */
export const VEHICLE_SPECS: Readonly<Record<'car' | 'motorcycle' | 'tracked', VehicleSpec>> =
  Object.freeze({
    car: Object.freeze<VehicleSpec>({
      ...COMMON,
      torquePerKg: 475 / 1470,
      idleRPM: 700,
      maxRPM: 6000,
      torqueCurve: [
        [0, 0.8],
        [0.25, 0.86],
        [4400 / 6000, 1],
        [1, 0.91],
      ],
      gears: CAR_GEARS,
      reverse: 2.9,
      finalDrive: 3.42,
      ...shifts(5600, 6000, CAR_GEARS),
      suspensionFrequency: 1.5,
      suspensionTravel: 0.2,
    }),
    motorcycle: Object.freeze<VehicleSpec>({
      ...COMMON,
      torquePerKg: 84 / (239 + 80),
      idleRPM: 1100,
      maxRPM: 9500,
      torqueCurve: [
        [0, 0.6],
        [7000 / 9500, 1],
        [1, 0.9],
      ],
      gears: BIKE_GEARS,
      reverse: 4,
      finalDrive: (1.93 * 40) / 16,
      ...shifts(9000, 9500, BIKE_GEARS),
      clutch: 2,
      suspensionFrequency: 2,
      suspensionTravel: 0.13,
    }),
    tracked: Object.freeze<VehicleSpec>({
      ...COMMON,
      torquePerKg: 5090 / 61300,
      idleRPM: 500,
      maxRPM: 4000,
      torqueCurve: [
        [0, 1],
        [1, 0.5],
      ],
      gears: TRACK_GEARS,
      reverse: 4,
      finalDrive: 6,
      ...shifts(4000, 4000, TRACK_GEARS),
      suspensionFrequency: 1,
      suspensionTravel: 0.3,
    }),
  });
