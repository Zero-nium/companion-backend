import { Router } from 'express';
import { sendAndWaitReply } from '../services/minds.js';

const router = Router();

router.get('/test-image', async (req, res) => {
  try {
    const mindId = process.env.MIND_ID!;
    const alias = 'test-image-2'; // use a fresh alias to avoid any stale state

    const reply = await sendAndWaitReply(
      alias,
      mindId,
      'Generate a small simple image of a blue circle and return it as an attachment. If you cannot generate images, please reply with the word "cannot".',
      120_000 // 2 minutes
    );

    res.json({ success: true, reply });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;