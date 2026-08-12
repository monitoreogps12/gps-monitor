import { Router, type IRouter } from "express";
import healthRouter from "./health";
import gpsRouter from "./gps";
import clientsRouter from "./clients";
import botRouter from "./bot";
import geofenceRouter from "./geofence";

const router: IRouter = Router();

router.use(healthRouter);
router.use(gpsRouter);
router.use(clientsRouter);
router.use(botRouter);
router.use(geofenceRouter);

export default router;
