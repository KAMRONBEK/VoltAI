import axios from "axios";

/**
 * Shared helpers for login-replay auth modules (beon, pro-tok, …). Tokbor predates this and
 * keeps its own copies; new sources use these so the token-extraction heuristic stays in one place.
 * Never log token values.
 */

const UA = "Dart/3.5 (dart:io)";

/** An axios client that surfaces 4xx bodies (so `send`/`verify` can report response keys). */
export function makeAuthClient(baseURL: string, ua = UA) {
  return axios.create({
    baseURL,
    timeout: 20000,
    headers: { "User-Agent": ua, "Content-Type": "application/json" },
    validateStatus: (s) => s >= 200 && s < 500
  });
}

/**
 * Find the most likely JWT/token in a response body or its `Authorization` header. Checks the
 * top level plus one level under common wrappers (`data`/`result`/`tokens`), so it survives the
 * many "where did they put the token" shapes without knowing the API in advance.
 */
export function pickToken(
  data: unknown,
  headers: Record<string, unknown> | undefined,
  prefer: string[]
): string | undefined {
  const fromHeader = headers?.authorization;
  if (typeof fromHeader === "string" && fromHeader) {
    return fromHeader.replace(/^Bearer\s+/i, "");
  }
  if (!data || typeof data !== "object") {
    return undefined;
  }
  const obj = data as Record<string, unknown>;
  const scopes = [obj, obj.data, obj.result, obj.tokens].filter(
    (v): v is Record<string, unknown> => !!v && typeof v === "object"
  );
  for (const scope of scopes) {
    for (const key of prefer) {
      const val = scope[key];
      if (typeof val === "string" && val.length > 10) {
        return val;
      }
    }
  }
  return undefined;
}

export function keysOf(data: unknown): string[] {
  return data && typeof data === "object" ? Object.keys(data as Record<string, unknown>) : [];
}
