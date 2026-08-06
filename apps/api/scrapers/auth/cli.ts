import dotenv from "dotenv";
import * as tokbor from "./tokbor";

dotenv.config();

/**
 * Login-replay CLI. OTP is interactive by nature, so this is a two-step flow:
 *
 *   npm run auth:tokbor -- send "+998901234567"     # sends OTP to your Telegram
 *   npm run auth:tokbor -- verify 12345             # completes login, stores tokens
 *   npm run auth:tokbor -- status                   # shows whether a token is stored
 *
 * Tokens are written to data/auth-tokens.json (gitignored). Values are never printed.
 */
async function main(): Promise<void> {
  const [cmd, arg, arg2] = process.argv.slice(2);

  switch (cmd) {
    case "send": {
      if (!arg) throw new Error('Usage: auth:tokbor -- send "+998XXXXXXXXX" [countryCode]');
      const result = await tokbor.sendPhone(arg, arg2 ?? "UZ");
      if (result.ok) {
        // eslint-disable-next-line no-console
        console.log(`OTP requested (HTTP ${result.status}). Check your Telegram (@tokbor_otp_bot).`);
        // eslint-disable-next-line no-console
        console.log('Then run: npm run auth:tokbor -- verify <code>');
      } else {
        // eslint-disable-next-line no-console
        console.error(`send failed (HTTP ${result.status}). Response keys: [${result.keys.join(", ")}]`);
      }
      break;
    }
    case "verify": {
      if (!arg) throw new Error("Usage: auth:tokbor -- verify <code>");
      const result = await tokbor.verifyOtp(arg);
      if (result.ok) {
        // eslint-disable-next-line no-console
        console.log(`Login OK (HTTP ${result.status}). Access + refresh tokens stored. Response keys: [${result.keys.join(", ")}]`);
      } else {
        // eslint-disable-next-line no-console
        console.error(`verify failed (HTTP ${result.status}). Response keys: [${result.keys.join(", ")}]`);
      }
      break;
    }
    case "refresh": {
      const token = await tokbor.refresh();
      // eslint-disable-next-line no-console
      console.log(token ? "Refreshed: new access token stored." : "Refresh failed (no/invalid refresh token).");
      break;
    }
    case "status": {
      // eslint-disable-next-line no-console
      console.log(tokbor.getAccessToken() ? "tokbor: access token present." : "tokbor: no token — run `send` then `verify`.");
      break;
    }
    default:
      // eslint-disable-next-line no-console
      console.log("Commands: send <phone> [cc] | verify <code> | refresh | status");
  }
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
