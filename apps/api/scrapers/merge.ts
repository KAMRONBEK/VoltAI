import "../src/env";
import { mergeStations } from "../src/services/mergeService";
import { disconnectDatabase } from "../src/db/sqlite";


async function run(): Promise<void> {
  // mergeService reads/writes the embedded SQLite store (opened lazily via getDb). Close it on the
  // way out so this CLI never leaves a pid record or lock behind next to a running server.
  try {
    const result = await mergeStations();
    // eslint-disable-next-line no-console
    console.log(`Merged stations: ${result.mergedCount}`);
  } finally {
    await disconnectDatabase();
  }
}

run().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
