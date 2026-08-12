import { Router, type IRouter } from "express";
import { db, alertZonesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// GET /api/geofences — list all active zones
router.get("/geofences", async (_req, res) => {
  try {
    const zones = await db
      .select()
      .from(alertZonesTable)
      .orderBy(alertZonesTable.createdAt);
    res.json(zones.map((z) => ({
      id: z.id,
      name: z.name,
      points: JSON.parse(z.points) as [number, number][],
      active: z.active,
      createdAt: z.createdAt,
    })));
  } catch (err) {
    logger.error({ err }, "Failed to list geofences");
    res.status(500).json({ error: "Internal error" });
  }
});

// POST /api/geofences — create a zone
router.post("/geofences", async (req, res) => {
  const { name, points } = req.body as { name?: string; points?: [number, number][] };
  if (!name?.trim() || !Array.isArray(points) || points.length < 3) {
    res.status(400).json({ error: "name and at least 3 points are required" });
    return;
  }
  try {
    const [zone] = await db
      .insert(alertZonesTable)
      .values({ name: name.trim(), points: JSON.stringify(points) })
      .returning();
    logger.info({ id: zone!.id, name: zone!.name }, "Geofence created");
    res.status(201).json({
      id: zone!.id,
      name: zone!.name,
      points,
      active: zone!.active,
      createdAt: zone!.createdAt,
    });
  } catch (err) {
    logger.error({ err }, "Failed to create geofence");
    res.status(500).json({ error: "Internal error" });
  }
});

// PATCH /api/geofences/:id — toggle active
router.patch("/geofences/:id", async (req, res) => {
  const id = parseInt(req.params["id"]!, 10);
  const { active } = req.body as { active?: boolean };
  if (isNaN(id) || active === undefined) {
    res.status(400).json({ error: "Invalid id or active field" });
    return;
  }
  try {
    await db.update(alertZonesTable).set({ active }).where(eq(alertZonesTable.id, id));
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Failed to update geofence");
    res.status(500).json({ error: "Internal error" });
  }
});

// DELETE /api/geofences/:id — remove a zone
router.delete("/geofences/:id", async (req, res) => {
  const id = parseInt(req.params["id"]!, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    await db.delete(alertZonesTable).where(eq(alertZonesTable.id, id));
    logger.info({ id }, "Geofence deleted");
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Failed to delete geofence");
    res.status(500).json({ error: "Internal error" });
  }
});

export default router;
