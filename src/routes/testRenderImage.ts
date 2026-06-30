import { Router } from 'express';
import { sendAndWaitReply } from '../services/minds.js';

const router = Router();

router.get('/test-render-image', async (req, res) => {
  try {
    const mindId = process.env.MIND_ID!;
    const alias = 'test-render-image-' + Date.now();

    const reply = await sendAndWaitReply(
      alias,
      mindId,
      'Generate an image of a small blue circle on a white background and return it as an attachment.',
      300000 // 5 minutes
    );

    // Return the full reply for inspection
    res.json({
      success: true,
      reply,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;