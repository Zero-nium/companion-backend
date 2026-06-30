import { Router } from 'express';
import { getClient, getHistory } from '../services/minds.js';

const router = Router();

router.get('/check-image', async (req, res) => {
  try {
    const alias = 'test-image-2';
    const client = await getClient();
    const history = await getHistory(alias, undefined, 10);
    // Log on the server side too
    console.log('[check-image] raw history:', JSON.stringify(history).substring(0, 1000));
    res.json({
      count: history.length,
      history: history.map((m: any) => ({
        role: m.role,
        text: m.messageText?.substring(0, 100),
        hasArtifact: !!m.artifact,
        artifactId: m.artifactId,
      })),
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;