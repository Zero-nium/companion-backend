import { Router } from 'express';
import { supabase } from '../db.js';
import {
  ensureConversation,
  sendMessage,
  getLatestFingerprint,
  getHistory,
  getClient,
  getArtifact,
} from '../services/minds.js';

const router = Router();
const ADMIN_KEY = process.env.ADMIN_KEY || 'dev-secret';

// POST /api/admin/render
router.post('/render', async (req, res) => { /* unchanged */ });

// POST /api/admin/render/:jobId/continue
router.post('/render/:jobId/continue', async (req, res) => {
  try {
    const { jobId } = req.params;
    const { data: job } = await supabase.from('jobs').select('*').eq('id', jobId).single();
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (job.status === 'completed' || job.status === 'failed') {
      return res.json({ jobId: job.id, status: job.status, result: job.result, error: job.error });
    }

    const { alias, mindId, palId, lastFingerprint } = job.result;
    const client = await getClient();
    const history = await getHistory(alias, lastFingerprint);

    const replies = history.filter((m: any) => m.role !== 'user' && m.role !== 'system');
    if (replies.length === 0) {
      console.log(`[Render ${jobId}] No reply yet.`);
      return res.json({ jobId, status: 'generating' });
    }

    const replyText = replies[replies.length - 1].messageText || '';
    console.log(`[Render ${jobId}] Reply received: ${replyText.substring(0, 200)}`);

    // Extract artifact ID from reply
    const artifactMatch = replyText.match(/artifact:\/\/([a-f0-9-]+)/);
    if (!artifactMatch) {
      await supabase.from('jobs').update({
        status: 'failed',
        error: 'No artifact:// link found in reply.',
        result: { ...job.result, reply: replyText },
      }).eq('id', jobId);
      return res.json({ jobId, status: 'failed', reply: replyText });
    }

    const artifactId = artifactMatch[1];
    console.log(`[Render ${jobId}] Found artifact ID: ${artifactId}`);

    // Fetch artifact from Minds
    const artifactData = await getArtifact(alias, artifactId);
    if (!artifactData) {
      await supabase.from('jobs').update({
        status: 'failed',
        error: 'Failed to fetch artifact from Minds.',
      }).eq('id', jobId);
      return res.json({ jobId, status: 'failed' });
    }

    // Decode and upload
    const imageBuffer = Buffer.from(artifactData.body, 'base64');
    const extension = artifactData.mimeType === 'image/png' ? 'png' : 'jpg';
    const fileName = `${palId}/${Date.now()}.${extension}`;

    const { error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(fileName, imageBuffer, { contentType: artifactData.mimeType, upsert: true });

    if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);

    const { data: publicUrl } = supabase.storage.from('avatars').getPublicUrl(fileName);
    const avatarUrl = publicUrl.publicUrl;

    await supabase.from('pals').update({ avatar_url: avatarUrl }).eq('id', palId);
    await supabase.from('jobs').update({
      status: 'completed',
      result: { ...job.result, avatarUrl },
      pal_id: palId,
      completed_at: new Date().toISOString(),
    }).eq('id', jobId);

    console.log(`[Render ${jobId}] Completed. Avatar URL: ${avatarUrl}`);
    res.json({ jobId, status: 'completed', avatarUrl });
  } catch (e: any) {
    console.error(`[Render] Error:`, e);
    res.status(500).json({ error: e.message });
  }
});

export default router;