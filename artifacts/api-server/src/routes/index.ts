import { Router, type IRouter } from "express";
import healthRouter from "./health";
import gpsRouter from "./gps";
import clientsRouter from "./clients";
import botRouter from "./bot";

const router: IRouter = Router();

router.use(healthRouter);
router.use(gpsRouter);
router.use(clientsRouter);
router.use(botRouter);

export default router;
