import { Router } from 'express';
import healthRouter from './health.js';
import paymentsRouter from './payments.js';
import feesRouter from './fees.js';

const router = Router();

router.use('/health', healthRouter);
router.use('/payments', paymentsRouter);
router.use('/fees', feesRouter);

export default router;
