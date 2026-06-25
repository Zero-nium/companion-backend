import { Router } from 'express';
import { sendAndWaitReply } from '../services/minds.js';

const router = Router();

router.get('/test-mind', async (req, res) => {
  try {
    const mindId = process.env.MIND_ID;
    if (!mindId) {
      return res.status(400).json({ error: 'MIND_ID not set in environment' });
    }

    const reply = await sendAndWaitReply(
      'test-awake',
      mindId,
      'Hello Poly! This is a test from the companion system. Please reply with the word "alive".'
    );

    res.json({ success: true, reply });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;