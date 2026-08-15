import "../../src/env";
import { connectDatabase, disconnectDatabase } from "../../src/db/sqlite";

/** Open the embedded SQLite DB around a CLI task (dev-box scrapers), closing it cleanly after. */
export async function withDatabase<T>(run: () => Promise<T>): Promise<T> {
  await connectDatabase();
  try {
    return await run();
  } finally {
    await disconnectDatabase();
  }
}
