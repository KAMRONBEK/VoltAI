import fs from "node:fs/promises";

interface HarEntry {
  response?: {
    content?: {
      mimeType?: string;
      text?: string;
    };
  };
  request?: {
    url?: string;
  };
}

interface HarFile {
  log?: {
    entries?: HarEntry[];
  };
}

export interface CandidateStationPayload {
  url: string;
  payload: unknown;
}

export async function parseHarCandidates(filePath: string): Promise<CandidateStationPayload[]> {
  const raw = await fs.readFile(filePath, "utf8");
  const data = JSON.parse(raw) as HarFile;
  const entries = data.log?.entries ?? [];
  const result: CandidateStationPayload[] = [];

  for (const entry of entries) {
    const url = entry.request?.url ?? "";
    const mimeType = entry.response?.content?.mimeType ?? "";
    const text = entry.response?.content?.text;

    if (!text || !looksJsonMime(mimeType)) {
      continue;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      continue;
    }

    if (containsGeoLikeArray(payload)) {
      result.push({ url, payload });
    }
  }

  return result;
}

function looksJsonMime(mimeType: string): boolean {
  return mimeType.includes("application/json") || mimeType.includes("+json") || mimeType === "";
}

function containsGeoLikeArray(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(looksStationLike);
  }

  if (!value || typeof value !== "object") {
    return false;
  }

  return Object.values(value as Record<string, unknown>).some((inner) => {
    if (Array.isArray(inner)) {
      return inner.some(looksStationLike);
    }
    if (inner && typeof inner === "object") {
      return containsGeoLikeArray(inner);
    }
    return false;
  });
}

function looksStationLike(value: unknown): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }
  const object = value as Record<string, unknown>;
  const keys = Object.keys(object).map((key) => key.toLowerCase());
  const hasLat = keys.some((key) => key.includes("lat"));
  const hasLng = keys.some((key) => key.includes("lng") || key.includes("lon"));
  const hasName = keys.some((key) => key.includes("name") || key.includes("title"));
  return (hasLat && hasLng) || (hasName && (hasLat || hasLng));
}
