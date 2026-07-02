import { Router } from 'express';
import { sendAndWaitReply } from '../services/minds.js';

const router = Router();

router.get('/render-direct', async (req, res) => {
  console.log('[render-direct] Request received');
  try {
    const mindId = process.env.MIND_ID!;
    const prompt = (req.query.prompt as string) || 'Generate an anime portrait of a scholar.';
    console.log('[render-direct] Prompt:', prompt);
    const alias = 'rd' + Date.now(); // short alias
    console.log('[render-direct] Using alias:', alias);

    const reply = await sendAndWaitReply(alias, mindId, prompt, 600000); // 10 minutes
    console.log('[render-direct] Reply received');

    const artifactMatch = reply.match(/artifact:\/\/([a-f0-9-]+)/);
    const artifactId = artifactMatch ? artifactMatch[1] : null;

    res.json({ success: true, reply, artifactId, alias });
  } catch (e: any) {
    console.error('[render-direct] Error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

export default router;