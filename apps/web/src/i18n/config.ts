export const locales = ["uz", "ru", "en"] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "uz";

export function toLocale(value: string): Locale | null {
  const v = value.trim().toLowerCase();
  if (v === "uz" || v === "ru" || v === "en") return v;
  return null;
}

export function isLocale(value: string): value is Locale {
  return toLocale(value) !== null;
}

