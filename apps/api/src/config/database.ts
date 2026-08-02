import mongoose from "mongoose";

const DEFAULT_URI = "mongodb://localhost:27017/voltai";

export async function connectDatabase(): Promise<void> {
  const mongoUri = process.env.MONGODB_URI ?? DEFAULT_URI;
  if (mongoose.connection.readyState === 1) {
    return;
  }

  await mongoose.connect(mongoUri, {
    dbName: undefined,
    serverSelectionTimeoutMS: 30_000
  });
}

export async function disconnectDatabase(): Promise<void> {
  if (mongoose.connection.readyState === 0) {
    return;
  }
  await mongoose.disconnect();
}
