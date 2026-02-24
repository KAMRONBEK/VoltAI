export const locales = ["uz", "ru", "en"] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "uz";

export function isLocale(value: string): value is Locale {
  // Keep this tiny and dependency-free.
  return (locales as readonly string[]).includes(value);
}

