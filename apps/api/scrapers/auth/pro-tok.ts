import type { AxiosResponse } from "axios";
import { getTokens, setTokens } from "./tokenStore";
import { keysOf, makeAuthClient, pickToken } from "./util";

/**
 * Pro-Tok login-replay (com.fintech_projects.fintech_project1 — Flutter, base crm.protok.uz/api).
 *
 * ⚠️ SHAPE UNCONFIRMED. The endpoint NAMES are extracted from the APK
 * (`/Sms/SendComfirmCode`, `/Sms/CheckComfirmCode`, `/Authorize` — their spelling), but the exact
 * request param names/casing and which call returns the bearer could NOT be derived by probing
 * (the CRM serves an SPA for unknown routes). The bodies below are best-guess; both `send` and
 * `verify` print the real response keys on failure so the first live run reveals the true shape —
 * then tighten the params here. Do not treat this as working until a real login succeeds.
 *
 * Never log token values.
 */

const SOURCE = "pro-tok";
const API_BASE = process.env.PROTOK_API_BASE ?? "https://crm.protok.uz/api";

function client() {
  return makeAuthClient(API_BASE);
}

/** Step 1 — request an OTP (SMS). Best-guess body; adjust param name from the printed keys. */
export async function sendPhone(phoneNumber: string): Promise<{ ok: boolean; status: number; keys: string[] }> {
  const res: AxiosResponse = await client().post("/Sms/SendComfirmCode", { phoneNumber });
  const data = res.data as Record<string, unknown> | undefined;
  // Ignore SPA HTML 200s: a real JSON API reply is an object, an SPA route is a long string.
  const looksSpa = typeof data === "string";
  if (res.status >= 400 || looksSpa) {
    return { ok: false, status: res.status, keys: looksSpa ? ["<html-spa>"] : keysOf(data) };
  }
  setTokens(SOURCE, { phoneNumber, obtainedAt: new Date().toISOString() });
  return { ok: true, status: res.status, keys: keysOf(data) };
}

/** Step 2 — check the code, then (if needed) authorize; stores the bearer. */
export async function verifyOtp(code: string): Promise<{ ok: boolean; status: number; keys: string[] }> {
  const { phoneNumber } = getTokens(SOURCE);
  if (!phoneNumber) {
    throw new Error("No phone number on record — run `send` first");
  }

  // Try CheckComfirmCode first (it may return the token directly), then /Authorize as a fallback.
  const attempts: Array<() => Promise<AxiosResponse>> = [
    () => client().post("/Sms/CheckComfirmCode", { phoneNumber, code }),
    () => client().post("/Authorize", { phoneNumber, code })
  ];

  let lastStatus = 0;
  let lastKeys: string[] = [];
  for (const attempt of attempts) {
    const res = await attempt();
    lastStatus = res.status;
    const data = res.data as Record<string, unknown> | undefined;
    if (typeof data === "string") {
      lastKeys = ["<html-spa>"];
      continue;
    }
    lastKeys = keysOf(data);
    const accessToken = pickToken(data, res.headers as Record<string, unknown>, [
      "accessToken",
      "access_token",
      "token"
    ]);
    if (res.status < 400 && accessToken) {
      const refreshToken = pickToken(data, undefined, ["refreshToken", "refresh_token"]);
      setTokens(SOURCE, { accessToken, refreshToken, obtainedAt: new Date().toISOString() });
      return { ok: true, status: res.status, keys: lastKeys };
    }
  }
  return { ok: false, status: lastStatus, keys: lastKeys };
}

/** No confirmed refresh endpoint yet; re-run the OTP login when the token expires. */
export async function refresh(): Promise<string | null> {
  return null;
}

export function getAccessToken(): string | null {
  return getTokens(SOURCE).accessToken ?? null;
}
