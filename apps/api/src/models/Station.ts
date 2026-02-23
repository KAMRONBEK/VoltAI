import { Schema, model, type InferSchemaType } from "mongoose";

const connectorSchema = new Schema(
  {
    type: { type: String, required: true, trim: true },
    power: { type: Number, required: false }
  },
  { _id: false }
);

const stationSchema = new Schema(
  {
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
    sources: { type: [String], required: true, default: [] },
    primarySource: { type: String, required: true, trim: true },
    updatedAt: { type: Date, required: true, default: Date.now }
  },
  {
    timestamps: true,
    versionKey: false
  }
);

stationSchema.index({ location: "2dsphere" });
stationSchema.index({ name: "text", address: "text" });

export type StationDocument = InferSchemaType<typeof stationSchema>;
export const StationModel = model("Station", stationSchema, "stations");
