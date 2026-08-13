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

/**
 * The normalized form plus its word set, computed once.
 *
 * Exists because the merge compares each incoming station against many existing ones, and
 * re-deriving the same normalized names inside that loop dominated the merge: two regex passes
 * and three Set allocations per comparison, ~2M times per cycle.
 */
export interface NameTokens {
  normalized: string;
  words: Set<string>;
}

export function nameTokens(value: string): NameTokens {
  const normalized = normalizedName(value);
  return { normalized, words: new Set(normalized ? normalized.split(" ") : []) };
}

/** Jaccard overlap of two pre-tokenized names. Identical semantics to nameSimilarity. */
export function similarityFromTokens(a: NameTokens, b: NameTokens): number {
  if (!a.normalized || !b.normalized) return 0;
  if (a.normalized === b.normalized) return 1;

  // Iterate the smaller set and count the union arithmetically, so neither a third Set nor an
  // intermediate array is allocated.
  const [small, large] = a.words.size <= b.words.size ? [a.words, b.words] : [b.words, a.words];
  let shared = 0;
  for (const word of small) {
    if (large.has(word)) shared++;
  }
  const total = a.words.size + b.words.size - shared;
  return total === 0 ? 0 : shared / total;
}

export function nameSimilarity(a: string, b: string): number {
  return similarityFromTokens(nameTokens(a), nameTokens(b));
}
