import { Router } from 'express';
import { getClient, getHistory } from '../services/minds.js';

const router = Router();

router.get('/check-image', async (req, res) => {
  try {
    const alias = 'test-image';
    const client = await getClient();
    // Get the latest 10 messages
    const history = await getHistory(alias, undefined, 10);
    // Filter for messages that contain artifacts
    const artifacts = history.filter((m: any) => m.artifact);
    res.json({
      messageCount: history.length,
      latestArtifacts: artifacts.map((m: any) => ({
        artifactId: m.artifactId,
        slug: m.slug,
        mimeType: m.mimeType,
        extension: m.extension,
        messageText: m.messageText?.substring(0, 100),
      })),
      allMessages: history.map((m: any) => ({
        role: m.role,
        messageText: m.messageText?.substring(0, 80),
        hasArtifact: !!m.artifact,
      })),
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;