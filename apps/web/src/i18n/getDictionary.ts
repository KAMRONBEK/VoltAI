import type { Locale } from "@/i18n/config";
import { dictionaries } from "@/i18n/dictionary";

export function getDictionary(locale: Locale) {
  return dictionaries[locale];
}

