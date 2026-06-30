import { Router } from 'express';
import { sendAndWaitReply } from '../services/minds.js';

const router = Router();

router.get('/test-mind', async (req, res) => {
  try {
    const mindId = process.env.MIND_ID!;
    const alias = 'test-awake-' + Date.now();  // unique each time

    const reply = await sendAndWaitReply(
      alias,
      mindId,
      'Hello Poly! This is a test from the companion system. Please reply with the word "alive".',
      120000 // 2 minutes
    );

    res.json({ success: true, reply });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;