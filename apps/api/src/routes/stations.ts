import { Router } from "express";
import {
  getStationById,
  listStations,
  nearbyStations,
  searchStations,
} from "../repositories/stationRepo";

const router = Router();

router.get("/", (req, res, next) => {
  try {
    const page = Number(req.query.page ?? 1);
    const limit = Math.min(Number(req.query.limit ?? 50), 200);
    const q = req.query.q ? String(req.query.q) : undefined;

    const { items, total } = listStations({ page, limit, q });

    res.json({ page, limit, total, items });
  } catch (error) {
    next(error);
  }
});

router.get("/nearby", (req, res, next) => {
  try {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    const radius = Number(req.query.radius ?? 5000);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ message: "lat and lng query params are required" });
    }

    const items = nearbyStations(lat, lng, radius);
    return res.json({ count: items.length, items });
  } catch (error) {
    return next(error);
  }
});

router.get("/search", (req, res, next) => {
  try {
    const q = String(req.query.q ?? "").trim();
    if (!q) {
      return res.status(400).json({ message: "q query param is required" });
    }

    const items = searchStations(q);
    return res.json({ count: items.length, items });
  } catch (error) {
    return next(error);
  }
});

router.get("/:id", (req, res, next) => {
  try {
    const { id } = req.params;
    // Canonical ids are content-derived 24-hex strings (see repositories/objectId.ts).
    if (!/^[0-9a-f]{24}$/.test(id)) {
      return res.status(400).json({ message: "invalid station id" });
    }
    const station = getStationById(id);
    if (!station) {
      return res.status(404).json({ message: "station not found" });
    }
    return res.json(station);
  } catch (error) {
    return next(error);
  }
});

export default router;
