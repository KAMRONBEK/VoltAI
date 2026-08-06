import axios, { type AxiosResponse } from "axios";
import { getTokens, setTokens } from "./tokenStore";

/**
 * Tokbor login-replay (uz.tokbor.tokbor).
 *
 * Flow discovered from the shipped Flutter libapp.so + live probing:
 *   1. POST /auth/verify-phone-number { phoneNumber, countryCode }  -> temp session token,
 *      and the 5-digit OTP is delivered to the user's Telegram (@tokbor_otp_bot).
 *   2. POST /auth/verify-otp { code }  with  Authorization: Bearer <tempToken>  -> access + refresh tokens.
 *   3. Use the access token as Bearer on /charging-station.
 *
 * Never log token values.
 */

const SOURCE = "tokbor";
const API_BASE = process.env.TOKBOR_API_BASE ?? "https://api.newtokbor.uz";
const UA = "Dart/3.5 (dart:io)";

function client() {
  return axios.create({
    baseURL: API_BASE,
    timeout: 20000,
    headers: { "User-Agent": UA, "Content-Type": "application/json" },
    validateStatus: (s) => s >= 200 && s < 500 // let us read 4xx bodies
  });
}

/** Find the most likely JWT/token field in a response body or headers. */
function pickToken(data: unknown, headers: Record<string, unknown>, prefer: string[]): string | undefined {
  const fromHeader = headers?.authorization;
  if (typeof fromHeader === "string" && fromHeader) {
    return fromHeader.replace(/^Bearer\s+/i, "");
  }
  if (!data || typeof data !== "object") {
    return undefined;
  }
  const obj = data as Record<string, unknown>;
  // check preferred keys (also one level deep under common wrappers)
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

/** Step 1 — request an OTP for a phone number (delivered via Telegram). */
export async function sendPhone(phoneNumber: string, countryCode = "UZ"): Promise<{ ok: boolean; status: number; keys: string[] }> {
  const res: AxiosResponse = await client().post("/auth/verify-phone-number", {
    phoneNumber,
    countryCode
  });
  const data = res.data as Record<string, unknown> | undefined;
  const tempToken = pickToken(data, res.headers as Record<string, unknown>, [
    "token",
    "tempToken",
    "verificationToken",
    "otpToken",
    "accessToken",
    "sessionToken"
  ]);
  if (res.status >= 400 || !tempToken) {
    return {
      ok: false,
      status: res.status,
      keys: data && typeof data === "object" ? Object.keys(data) : []
    };
  }
  setTokens(SOURCE, { tempToken, obtainedAt: new Date().toISOString() });
  return { ok: true, status: res.status, keys: data ? Object.keys(data) : [] };
}

/** Step 2 — verify the OTP using the temp token; stores access + refresh tokens. */
export async function verifyOtp(code: string): Promise<{ ok: boolean; status: number; keys: string[] }> {
  const { tempToken } = getTokens(SOURCE);
  if (!tempToken) {
    throw new Error("No temp token — run `send` first");
  }
  const res: AxiosResponse = await client().post(
    "/auth/verify-otp",
    { code },
    { headers: { Authorization: `Bearer ${tempToken}` } }
  );
  const data = res.data as Record<string, unknown> | undefined;
  const accessToken = pickToken(data, res.headers as Record<string, unknown>, [
    "accessToken",
    "access_token",
    "token"
  ]);
  const refreshToken = pickToken(data, {}, ["refreshToken", "refresh_token"]);
  if (res.status >= 400 || !accessToken) {
    return {
      ok: false,
      status: res.status,
      keys: data && typeof data === "object" ? Object.keys(data) : []
    };
  }
  setTokens(SOURCE, { accessToken, refreshToken, obtainedAt: new Date().toISOString(), tempToken: undefined });
  return { ok: true, status: res.status, keys: data ? Object.keys(data) : [] };
}

/** Best-effort access-token refresh using the stored refresh token. */
export async function refresh(): Promise<string | null> {
  const { refreshToken } = getTokens(SOURCE);
  if (!refreshToken) {
    return null;
  }
  // Try the shapes NestJS backends commonly use for refresh.
  const attempts: Array<() => Promise<AxiosResponse>> = [
    () => client().post("/auth/refresh", { refreshToken }),
    () =>
      client().post("/auth/refresh", {}, { headers: { Authorization: `Bearer ${refreshToken}` } }),
    () => client().post("/auth/refresh", { refresh_token: refreshToken })
  ];
  for (const attempt of attempts) {
    try {
      const res = await attempt();
      if (res.status >= 400) {
        continue;
      }
      const accessToken = pickToken(res.data, res.headers as Record<string, unknown>, [
        "accessToken",
        "access_token",
        "token"
      ]);
      const newRefresh = pickToken(res.data, {}, ["refreshToken", "refresh_token"]);
      if (accessToken) {
        setTokens(SOURCE, {
          accessToken,
          refreshToken: newRefresh ?? refreshToken,
          obtainedAt: new Date().toISOString()
        });
        return accessToken;
      }
    } catch {
      // try next shape
    }
  }
  return null;
}

/** Current access token (no network). The scraper refreshes on a 401. */
export function getAccessToken(): string | null {
  return getTokens(SOURCE).accessToken ?? null;
}
