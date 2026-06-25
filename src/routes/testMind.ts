// src/routes/testMind.ts
import { Router } from 'express';
import { sendAndWaitReply, resolveMindId } from '../services/minds.js';

const router = Router();

router.get('/test-mind', async (req, res) => {
  try {
    const email = process.env.AGENT_EMAIL!;
    const mindId = await resolveMindId(email);

    if (!mindId) {
      return res
        .status(404)
        .json({ error: `No Mind found with email ${email}` });
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