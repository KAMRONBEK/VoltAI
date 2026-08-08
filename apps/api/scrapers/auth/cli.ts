import dotenv from "dotenv";
import * as beon from "./beon";
import * as proTok from "./pro-tok";
import * as tokbor from "./tokbor";

dotenv.config();

/**
 * Login-replay CLI for OTP-gated operator sources. The npm script bakes in the source, e.g.
 *
 *   npm run auth:tokbor  -- send "+998901234567"   # OTP to Telegram (@tokbor_otp_bot)
 *   npm run auth:beon    -- send "+998901234567"   # OTP via SMS
 *   npm run auth:pro-tok -- send "+998901234567"   # OTP via SMS (shape unconfirmed — see below)
 *   npm run auth:<src>   -- verify 12345           # completes login, stores tokens
 *   npm run auth:<src>   -- status                 # whether a token is stored
 *
 * Tokens go to data/auth-tokens.json (gitignored, mode 0600). Values are never printed — on
 * failure we print only the response KEYS, which is how you pin an unconfirmed request shape.
 */

interface CliProvider {
  sendPhone: (phone: string, cc?: string) => Promise<{ ok: boolean; status: number; keys: string[] }>;
  verifyOtp: (code: string) => Promise<{ ok: boolean; status: number; keys: string[] }>;
  refresh: () => Promise<string | null>;
  getAccessToken: () => string | null;
  otpHint: string;
}

const PROVIDERS: Record<string, CliProvider> = {
  tokbor: {
    sendPhone: tokbor.sendPhone,
    verifyOtp: tokbor.verifyOtp,
    refresh: tokbor.refresh,
    getAccessToken: tokbor.getAccessToken,
    otpHint: "your Telegram (@tokbor_otp_bot)"
  },
  beon: {
    sendPhone: beon.sendPhone,
    verifyOtp: beon.verifyOtp,
    refresh: beon.refresh,
    getAccessToken: beon.getAccessToken,
    otpHint: "an SMS on your phone"
  },
  "pro-tok": {
    sendPhone: proTok.sendPhone,
    verifyOtp: proTok.verifyOtp,
    refresh: proTok.refresh,
    getAccessToken: proTok.getAccessToken,
    otpHint: "an SMS on your phone"
  }
};

async function main(): Promise<void> {
  const [source, cmd, arg, arg2] = process.argv.slice(2);
  const provider = source ? PROVIDERS[source] : undefined;
  if (!provider) {
    // eslint-disable-next-line no-console
    console.error(`Unknown or missing source. Available: ${Object.keys(PROVIDERS).join(", ")}`);
    process.exit(1);
    return;
  }

  switch (cmd) {
    case "send": {
      if (!arg) throw new Error(`Usage: auth:${source} -- send "+998XXXXXXXXX"`);
      const result = await provider.sendPhone(arg, arg2);
      if (result.ok) {
        // eslint-disable-next-line no-console
        console.log(`OTP requested (HTTP ${result.status}). Check ${provider.otpHint}.`);
        // eslint-disable-next-line no-console
        console.log(`Then run: npm run auth:${source} -- verify <code>`);
      } else {
        // eslint-disable-next-line no-console
        console.error(`send failed (HTTP ${result.status}). Response keys: [${result.keys.join(", ")}]`);
      }
      break;
    }
    case "verify": {
      if (!arg) throw new Error(`Usage: auth:${source} -- verify <code>`);
      const result = await provider.verifyOtp(arg);
      if (result.ok) {
        // eslint-disable-next-line no-console
        console.log(`Login OK (HTTP ${result.status}). Token stored. Response keys: [${result.keys.join(", ")}]`);
      } else {
        // eslint-disable-next-line no-console
        console.error(`verify failed (HTTP ${result.status}). Response keys: [${result.keys.join(", ")}]`);
      }
      break;
    }
    case "refresh": {
      const token = await provider.refresh();
      // eslint-disable-next-line no-console
      console.log(token ? "Refreshed: new access token stored." : "Refresh failed (no/invalid refresh token).");
      break;
    }
    case "status": {
      // eslint-disable-next-line no-console
      console.log(provider.getAccessToken() ? `${source}: access token present.` : `${source}: no token — run \`send\` then \`verify\`.`);
      break;
    }
    default:
      // eslint-disable-next-line no-console
      console.log(`Commands: send <phone> | verify <code> | refresh | status  (source: ${source})`);
  }
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
