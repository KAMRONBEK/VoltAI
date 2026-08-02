import { Schema, model, type InferSchemaType } from "mongoose";

const connectorSchema = new Schema(
  {
    type: { type: String, required: true, trim: true },
    power: { type: Number, required: false },
    status: { type: String, required: false, trim: true }
  },
  { _id: false }
);

const rawStationSchema = new Schema(
  {
    source: { type: String, required: true, trim: true },
    externalId: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    address: { type: String, required: false, trim: true },
    location: {
      type: {
        type: String,
        enum: ["Point"],
        default: "Point",
        required: true
      },
      coordinates: {
        type: [Number],
        required: true,
        validate: {
          validator: (arr: number[]) => arr.length === 2,
          message: "location.coordinates must have [lng, lat]"
        }
      }
    },
    connectors: { type: [connectorSchema], default: [] },
    workingHours: { type: String, required: false, trim: true },
    rating: { type: Number, required: false },
    rawData: { type: Schema.Types.Mixed, required: false },
    scrapedAt: { type: Date, required: true, default: Date.now }
  },
  {
    timestamps: true,
    versionKey: false
  }
);

rawStationSchema.index({ source: 1, externalId: 1 }, { unique: true });
rawStationSchema.index({ location: "2dsphere" });

export type RawStationDocument = InferSchemaType<typeof rawStationSchema>;
export const RawStationModel = model("RawStation", rawStationSchema, "raw_stations");
