/**
 * Where the VoltAI backend lives. Overridable via `EXPO_PUBLIC_API_BASE_URL` for local/staging dev
 * (e.g. `http://127.0.0.1:8080` through `adb reverse`); defaults to production.
 *
 * `.trim()` + `||` rather than `??`: an env var that is *set but empty* (a blank line in `.env`, an
 * EAS secret cleared but not deleted) used to win over the default, and every request then went to
 * `"/api/..."` — a relative URL, which `fetch` rejects on native. Empty now means "use production".
 * Trailing slashes are stripped so `${API_BASE_URL}/api/...` never becomes `//api/...`.
 */
const raw = process.env.EXPO_PUBLIC_API_BASE_URL?.trim();
export const API_BASE_URL = (raw || 'https://api.voltai.uz').replace(/\/+$/, '');
