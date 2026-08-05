import dotenv from "dotenv";
import { mergeStations } from "../src/services/mergeService";

dotenv.config();

async function run(): Promise<void> {
  // mergeService now reads/writes the embedded SQLite store (opened lazily via getDb),
  // so no external database connection is needed here.
  const result = await mergeStations();
  // eslint-disable-next-line no-console
  console.log(`Merged stations: ${result.mergedCount}`);
}

run().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
