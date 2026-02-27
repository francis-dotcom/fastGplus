import { Router } from 'express';
import healthRouter from './health.js';
import paymentsRouter from './payments.js';

const router = Router();

router.use('/health', healthRouter);
router.use('/payments', paymentsRouter);

export default router;
