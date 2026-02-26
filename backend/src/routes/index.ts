import { Router } from 'express';
import healthRouter from './health.js';

const router = Router();

router.use('/health', healthRouter);

// Mount more route modules here, e.g.:
// router.use('/applications', applicationsRouter);
// router.use('/webhooks', webhooksRouter);

export default router;
