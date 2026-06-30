import { Router } from 'express';
import { supabase } from '../db.js';
import { ensureConversation, sendMessage, getLatestFingerprint, getHistory, getClient } from '../services/minds.js';

const router = Router();

// POST /api/admin/test-image – start the image capability test
router.post('/test-image', async (req, res) => {
  try {
    const mindId = process.env.MIND_ID!;
    const alias = `test-image-${Date.now()}`; // unique alias per run

    // Ensure conversation exists
    await ensureConversation(alias, mindId);

    // Send a simple yes/no question
    await sendMessage(alias, mindId, 'Can you generate images and return them as attachments? Reply with exactly "yes" or "no".');
    const fingerprint = await getLatestFingerprint(alias);

    // Create a job record
    const { data: job } = await supabase
      .from('jobs')
      .insert({
        type: 'image_test',
        status: 'sent',
        result: { alias, mindId, lastFingerprint: fingerprint },
      })
      .select('id')
      .single();

    res.json({ success: true, jobId: job!.id, status: 'sent' });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/test-image/:jobId/continue – check for a reply
router.post('/test-image/:jobId/continue', async (req, res) => {
  try {
    const { jobId } = req.params;
    const { data: job } = await supabase.from('jobs').select('*').eq('id', jobId).single();
    if (!job) return res.status(404).json({ error: 'Job not found' });

    if (job.status === 'completed' || job.status === 'failed') {
      return res.json({ jobId, status: job.status, result: job.result, error: job.error });
    }

    const { alias, mindId, lastFingerprint } = job.result;
    const client = await getClient();
    const history = await getHistory(alias, lastFingerprint);

    // Find replies from Poly (role not 'user')
    const replies = history.filter((m: any) => m.role !== 'user' && m.role !== 'system');
    if (replies.length === 0) {
      // No reply yet
      return res.json({ jobId, status: 'sent' });
    }

    const replyText = replies[replies.length - 1].messageText || '';

    // Determine capability from reply
    const canGenerate = replyText.toLowerCase().includes('yes');
    await supabase.from('jobs').update({
      status: 'completed',
      result: { ...job.result, reply: replyText, canGenerate },
    }).eq('id', jobId);

    res.json({ jobId, status: 'completed', reply: replyText, canGenerate });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;