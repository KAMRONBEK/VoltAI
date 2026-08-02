import fs from "node:fs/promises";
import path from "node:path";

export interface CrawlCheckpoint {
  completed: string[];
  updatedAt: string;
}

function checkpointPath(provider: "google" | "yandex"): string {
  return path.join("tmp", `${provider}-crawl-checkpoint.json`);
}

export async function loadCheckpoint(provider: "google" | "yandex"): Promise<CrawlCheckpoint> {
  const filePath = checkpointPath(provider);
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as CrawlCheckpoint;
    return {
      completed: Array.isArray(parsed.completed) ? parsed.completed : [],
      updatedAt: parsed.updatedAt ?? new Date().toISOString()
    };
  } catch {
    return { completed: [], updatedAt: new Date().toISOString() };
  }
}

export async function saveCheckpoint(
  provider: "google" | "yandex",
  completed: Set<string>
): Promise<void> {
  await fs.mkdir("tmp", { recursive: true });
  const payload: CrawlCheckpoint = {
    completed: Array.from(completed.values()),
    updatedAt: new Date().toISOString()
  };
  await fs.writeFile(checkpointPath(provider), JSON.stringify(payload, null, 2), "utf8");
}
