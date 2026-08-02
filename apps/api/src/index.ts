import app from "./app";
import { connectDatabase } from "./config/database";

const port = Number(process.env.PORT ?? 3000);

async function start(): Promise<void> {
  await connectDatabase();
  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`VoltAI API listening on port ${port}`);
  });
}

start().catch((error) => {
  // eslint-disable-next-line no-console
  console.error("Failed to start server", error);
  process.exit(1);
});
