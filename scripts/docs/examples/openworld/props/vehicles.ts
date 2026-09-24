/**
 * Every vehicle of the open world: the specs the page rebuilds and moves at runtime
 * (`VEHICLE_SPECS`, JSON-able), and the same vehicles as static props for parked and traffic
 * copies (`vehicleProps`, ids `vehicle-<id>`).
 */
import type { PropMesh } from '../plan/contract.ts';
import { airliner } from './airliner.ts';
import { CAR_DRAFTS } from './car-models.ts';
import { helicopter } from './helicopter.ts';
import { lightPlane } from './light-plane.ts';
import { vehicleProp, withBounds } from './vehicle-parts.ts';
import type { VehicleSpec } from './vehicle-spec.ts';

export const VEHICLE_SPECS: readonly VehicleSpec[] = [
  ...CAR_DRAFTS,
  airliner(),
  lightPlane(),
  helicopter(),
].map(withBounds);

/** Every vehicle as one static prop, all parts included. */
export const vehicleProps = (): PropMesh[] => VEHICLE_SPECS.map((spec) => vehicleProp(spec));
