import { getDistance } from "geolib";

const STOP_WORDS = new Set([
  "ev",
  "charging",
  "station",
  "elektro",
  "зарядная",
  "станция",
  "zaryadlash",
  "tok"
]);

export function distanceMeters(a: [number, number], b: [number, number]): number {
  const [lngA, latA] = a;
  const [lngB, latB] = b;
  return getDistance(
    { latitude: latA, longitude: lngA },
    { latitude: latB, longitude: lngB }
  );
}

export function normalizedName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9а-яёқғҳў\s-]/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter((word) => word && !STOP_WORDS.has(word))
    .join(" ");
}

export function nameSimilarity(a: string, b: string): number {
  const left = normalizedName(a);
  const right = normalizedName(b);
  if (!left || !right) return 0;
  if (left === right) return 1;

  const leftWords = new Set(left.split(" "));
  const rightWords = new Set(right.split(" "));
  const shared = Array.from(leftWords).filter((word) => rightWords.has(word)).length;
  const total = new Set([...leftWords, ...rightWords]).size;
  return total === 0 ? 0 : shared / total;
}
