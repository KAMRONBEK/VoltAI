import { getJson, setJson } from '@/lib/storage/jsonStorage';
import { StorageKeys } from '@/lib/storage/storageKeys';

export type VehicleProfile = {
  make: string;
  model: string;
  rangeKm: number;
};

export async function loadVehicleProfile(): Promise<VehicleProfile | null> {
  return getJson<VehicleProfile>(StorageKeys.vehicleProfile);
}

export async function saveVehicleProfile(profile: VehicleProfile): Promise<void> {
  await setJson(StorageKeys.vehicleProfile, profile);
}

