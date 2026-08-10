import { Router, type IRouter } from "express";
import {
  fetchDevices,
  fetchLivePositions,
  fetchFleetStats,
  getConnectionStatus,
  fetchDeviceSensors,
  fetchOfflineReport,
} from "../lib/gps-service";
import { getRecentEvents } from "../bots/notifications";
import {
  ListDevicesResponse,
  GetLivePositionsResponse,
  GetFleetStatsResponse,
  GetConnectionStatusResponse,
  GetRecentEventsResponse,
  GetDeviceSensorsResponse,
  GetOfflineReportResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/gps/connection", async (req, res): Promise<void> => {
  try {
    const status = await getConnectionStatus();
    res.json(GetConnectionStatusResponse.parse(status));
  } catch (err) {
    req.log.error({ err }, "Failed to get connection status");
    res.status(503).json({ error: "Failed to check connection" });
  }
});

router.get("/gps/devices", async (req, res): Promise<void> => {
  try {
    const devices = await fetchDevices();
    res.json(ListDevicesResponse.parse(devices));
  } catch (err) {
    req.log.error({ err }, "Failed to fetch devices");
    res.status(503).json({ error: "Cannot connect to GPS tracking platform" });
  }
});

router.get("/gps/devices/live", async (req, res): Promise<void> => {
  try {
    const positions = await fetchLivePositions();
    res.json(GetLivePositionsResponse.parse(positions));
  } catch (err) {
    req.log.error({ err }, "Failed to fetch live positions");
    res.status(503).json({ error: "Cannot connect to GPS tracking platform" });
  }
});

router.get("/gps/stats", async (req, res): Promise<void> => {
  try {
    const stats = await fetchFleetStats();
    res.json(GetFleetStatsResponse.parse(stats));
  } catch (err) {
    req.log.error({ err }, "Failed to fetch fleet stats");
    res.status(503).json({ error: "Failed to get fleet statistics" });
  }
});

router.get("/gps/events/recent", (req, res): void => {
  const limit = Math.min(Number(req.query.limit) || 50, 100);
  const events = getRecentEvents(limit);
  res.json(GetRecentEventsResponse.parse(events));
});

router.get("/gps/offline-report", async (req, res): Promise<void> => {
  try {
    const report = await fetchOfflineReport();
    res.json(GetOfflineReportResponse.parse(report));
  } catch (err) {
    req.log.error({ err }, "Failed to fetch offline report");
    res.status(503).json({ error: "Cannot connect to GPS tracking platform" });
  }
});

router.get("/gps/devices/:id/sensors", async (req, res): Promise<void> => {
  try {
    const sensors = await fetchDeviceSensors(req.params.id);
    res.json(GetDeviceSensorsResponse.parse(sensors));
  } catch (err) {
    req.log.error({ err }, "Failed to fetch device sensors");
    res.status(503).json({ error: "Cannot connect to GPS tracking platform" });
  }
});

export default router;
