import { Router } from "express";
import { isValidObjectId } from "mongoose";
import { StationModel } from "../models/Station";

const router = Router();

router.get("/", async (req, res, next) => {
  try {
    const page = Number(req.query.page ?? 1);
    const limit = Math.min(Number(req.query.limit ?? 50), 200);
    const skip = (Math.max(page, 1) - 1) * Math.max(limit, 1);

    const query: Record<string, unknown> = {};

    if (req.query.q) {
      query.$text = { $search: String(req.query.q) };
    }

    const [items, total] = await Promise.all([
      StationModel.find(query).skip(skip).limit(limit).sort({ updatedAt: -1 }).lean(),
      StationModel.countDocuments(query)
    ]);

    res.json({
      page,
      limit,
      total,
      items
    });
  } catch (error) {
    next(error);
  }
});

router.get("/nearby", async (req, res, next) => {
  try {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    const radius = Number(req.query.radius ?? 5000);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ message: "lat and lng query params are required" });
    }

    const docs = await StationModel.aggregate([
      {
        $geoNear: {
          near: {
            type: "Point",
            coordinates: [lng, lat]
          },
          distanceField: "distanceMeters",
          maxDistance: radius,
          spherical: true
        }
      },
      { $sort: { distanceMeters: 1 } },
      { $limit: 200 }
    ]);

    return res.json({ count: docs.length, items: docs });
  } catch (error) {
    return next(error);
  }
});

router.get("/search", async (req, res, next) => {
  try {
    const q = String(req.query.q ?? "").trim();
    if (!q) {
      return res.status(400).json({ message: "q query param is required" });
    }

    const items = await StationModel.find({ $text: { $search: q } })
      .limit(100)
      .sort({ score: { $meta: "textScore" } })
      .lean();

    return res.json({ count: items.length, items });
  } catch (error) {
    return next(error);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return res.status(400).json({ message: "invalid station id" });
    }
    const station = await StationModel.findById(id).lean();
    if (!station) {
      return res.status(404).json({ message: "station not found" });
    }
    return res.json(station);
  } catch (error) {
    return next(error);
  }
});

export default router;
