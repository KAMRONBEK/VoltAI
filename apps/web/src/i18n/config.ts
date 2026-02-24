export const locales = ["uz", "ru", "en"] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "uz";

export function toLocale(value: unknown): Locale | null {
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  if (v === "uz" || v === "ru" || v === "en") return v;
  return null;
}

export function isLocale(value: unknown): value is Locale {
  return toLocale(value) !== null;
}

