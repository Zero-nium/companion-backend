import { Router } from 'express';
import { sendEmailToAgent } from '../services/email';
import crypto from 'crypto';

const router = Router();

router.get('/test-email', async (req, res) => {
  try {
    const messageId = crypto.randomUUID();
    await sendEmailToAgent(
      process.env.AGENT_EMAIL!,
      `user-test@${process.env.PROXY_DOMAIN}`,
      'TEST: Awake Check',
      'Hello! This is a test from the companion system. Please reply with just the word "alive".',
      messageId
    );
    res.json({ success: true, messageId });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;