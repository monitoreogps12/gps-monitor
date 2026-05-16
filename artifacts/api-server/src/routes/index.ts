import { Router, type IRouter } from "express";
import healthRouter from "./health";
import gpsRouter from "./gps";

const router: IRouter = Router();

router.use(healthRouter);
router.use(gpsRouter);

export default router;
