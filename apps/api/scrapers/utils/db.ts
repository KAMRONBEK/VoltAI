import dotenv from "dotenv";
import { connectDatabase, disconnectDatabase } from "../../src/config/database";

dotenv.config();

export async function withDatabase<T>(run: () => Promise<T>): Promise<T> {
  await connectDatabase();
  try {
    return await run();
  } finally {
    await disconnectDatabase();
  }
}
