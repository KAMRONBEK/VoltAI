import type { AxiosResponse } from "axios";
import { getTokens, setTokens } from "./tokenStore";
import { keysOf, makeAuthClient, pickToken } from "./util";

/**
 * Beon login-replay (uz.beonapp.uz — Flutter, base api.v2.beon-app.com).
 *
 * Flow (endpoints confirmed live; no captcha, no attestation — the success-body shape is
 * discovered on the first real login, so `pickToken` scans common shapes):
 *   1. POST /auth/login      { phoneNumber }   -> temp session token + SMS OTP to the user's phone.
 *   2. POST /auth/verify-otp { code }  with  Authorization: Bearer <tempToken>  -> access token.
 *      verify takes ONLY the code (a string); passing phoneNumber is rejected ("not allowed"),
 *      and omitting the bearer is rejected ("TOKEN_IS_NOT_PROVIDED").
 *   3. Use the access token as Bearer on GET /map.
 *
 * `send` persists the temp token (+ the phone number) for the verify step.
 * Never log token values.
 */

const SOURCE = "beon";
const API_BASE = process.env.BEON_API_BASE ?? "https://api.v2.beon-app.com";

function client() {
  return makeAuthClient(API_BASE);
}

/** Step 1 — request an OTP for a phone number (delivered via SMS). */
export async function sendPhone(phoneNumber: string): Promise<{ ok: boolean; status: number; keys: string[] }> {
  const res: AxiosResponse = await client().post("/auth/login", { phoneNumber });
  const data = res.data as Record<string, unknown> | undefined;
  if (res.status >= 400) {
    return { ok: false, status: res.status, keys: keysOf(data) };
  }
  // Persist the number so `verify` can send it back; some backends also return a temp token here.
  const tempToken = pickToken(data, res.headers as Record<string, unknown>, [
    "token",
    "tempToken",
    "verificationToken",
    "otpToken",
    "sessionToken"
  ]);
  setTokens(SOURCE, { phoneNumber, tempToken, obtainedAt: new Date().toISOString() });
  return { ok: true, status: res.status, keys: keysOf(data) };
}

/** Step 2 — verify the OTP; stores the access (+ refresh) token. */
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
  const refreshToken = pickToken(data, undefined, ["refreshToken", "refresh_token"]);
  if (res.status >= 400 || !accessToken) {
    return { ok: false, status: res.status, keys: keysOf(data) };
  }
  setTokens(SOURCE, { accessToken, refreshToken, obtainedAt: new Date().toISOString(), tempToken: undefined });
  return { ok: true, status: res.status, keys: keysOf(data) };
}

/** Best-effort access-token refresh using the stored refresh token. */
export async function refresh(): Promise<string | null> {
  const { refreshToken } = getTokens(SOURCE);
  if (!refreshToken) {
    return null;
  }
  const attempts: Array<() => Promise<AxiosResponse>> = [
    () => client().post("/auth/refresh", { refreshToken }),
    () => client().post("/auth/refresh", {}, { headers: { Authorization: `Bearer ${refreshToken}` } }),
    () => client().post("/auth/refresh", { refresh_token: refreshToken })
  ];
  for (const attempt of attempts) {
    try {
      const res = await attempt();
      if (res.status >= 400) continue;
      const accessToken = pickToken(res.data, res.headers as Record<string, unknown>, [
        "accessToken",
        "access_token",
        "token"
      ]);
      const newRefresh = pickToken(res.data, undefined, ["refreshToken", "refresh_token"]);
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
