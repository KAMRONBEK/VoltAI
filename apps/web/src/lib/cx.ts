export type ClassValue = string | undefined | null | false;

export function cx(...values: ClassValue[]) {
  return values.filter(Boolean).join(" ");
}

