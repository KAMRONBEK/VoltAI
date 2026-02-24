export const locales = ["uz", "ru", "en"] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "uz";

export function toLocale(value: unknown): Locale | null {
  const raw =
    typeof value === "string"
      ? value
      : Array.isArray(value) && typeof value[0] === "string"
        ? value[0]
        : null;
  if (raw === null) return null;

  const v = raw.trim().toLowerCase();
  if (v === "uz" || v === "ru" || v === "en") return v;
  return null;
}

export function isLocale(value: unknown): value is Locale {
  return toLocale(value) !== null;
}

