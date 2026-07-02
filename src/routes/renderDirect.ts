import { Router } from 'express';
import { sendAndWaitReply } from '../services/minds.js';

const router = Router();

router.get('/render-direct', async (req, res) => {
  try {
    const mindId = process.env.MIND_ID!;
    const prompt = (req.query.prompt as string) || 'Generate an anime portrait of a scholar.';
    const alias = 'render-direct-' + Date.now();

    const reply = await sendAndWaitReply(alias, mindId, prompt, 600000); // 10 minutes

    const artifactMatch = reply.match(/artifact:\/\/([a-f0-9-]+)/);
    const artifactId = artifactMatch ? artifactMatch[1] : null;

    res.json({ success: true, reply, artifactId });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;