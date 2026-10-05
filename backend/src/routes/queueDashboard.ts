import { Router } from 'express';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { createBullBoard } from '@bull-board/api';
import { ExpressAdapter } from '@bull-board/express';
import { emailQueue } from '../lib/queue';
import { requireAuth } from '../middleware/requireAuth';

const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath('/admin/queues');
createBullBoard({
  queues: [new BullMQAdapter(emailQueue)],
  serverAdapter,
});

const router = Router();
router.use(requireAuth);
router.use(serverAdapter.getRouter());

export default router;
