import { Router } from 'express';
import { getClient, ensureConversation, sendMessage, getHistory, getLatestFingerprint } from '../services/minds.js';

const router = Router();

router.get('/test-image', async (req, res) => {
  try {
    const mindId = process.env.MIND_ID!;
    const alias = 'test-image';
    await ensureConversation(alias, mindId);
    await sendMessage(alias, mindId, 'Generate a small simple image of a blue circle and return it as an attachment.');
    res.json({ success: true, message: 'Sent' });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;