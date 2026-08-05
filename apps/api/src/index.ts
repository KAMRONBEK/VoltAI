import cron from "node-cron";
import app from "./app";
import { connectDatabase } from "./db/sqlite";
import { mergeStations } from "./services/mergeService";

const port = Number(process.env.PORT ?? 3000);

async function start(): Promise<void> {
  await connectDatabase();
  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`VoltAI API listening on port ${port}`);
  });

  scheduleMerge();
}

/** Rebuild the canonical `stations` table from raw captures on a schedule. */
function scheduleMerge(): void {
  const expression = process.env.MERGE_CRON ?? "*/15 * * * *";
  let merging = false;

  cron.schedule(expression, async () => {
    if (merging) {
      return;
    }
    merging = true;
    try {
      const { mergedCount } = await mergeStations();
      // eslint-disable-next-line no-console
      console.log(`[merge] ${mergedCount} canonical stations`);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("[merge] failed", error);
    } finally {
      merging = false;
    }
  });
}

start().catch((error) => {
  // eslint-disable-next-line no-console
  console.error("Failed to start server", error);
  process.exit(1);
});
