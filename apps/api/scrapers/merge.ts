import dotenv from "dotenv";
import { mergeStations } from "../src/services/mergeService";
import { withDatabase } from "./utils/db";

dotenv.config();

async function run(): Promise<void> {
  await withDatabase(async () => {
    const result = await mergeStations();
    // eslint-disable-next-line no-console
    console.log(`Merged stations: ${result.mergedCount}`);
  });
}

run().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
