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

// -----------------------------------------------------------------
// POST /api/admin/render – start image generation
// -----------------------------------------------------------------
router.post('/render', async (req, res) => {
  try {
    const { adminKey, palId, prompt } = req.body;
    if (adminKey !== ADMIN_KEY) return res.status(403).json({ error: 'Unauthorized' });

    // Get the mindId for this pal
    const { data: pal } = await supabase.from('pals').select('mind_email').eq('id', palId).single();
    if (!pal) return res.status(404).json({ error: 'Pal not found' });

    const mindId = pal.mind_email.split('@')[0];
    const alias = `render-${palId}-${Date.now()}`;

    // Ensure conversation and send the image request
    await ensureConversation(alias, mindId);
    await sendMessage(alias, mindId, `Generate an image using the following prompt and return it as an attachment:\n\n${prompt}`);
    const fingerprint = await getLatestFingerprint(alias);

    const { data: job } = await supabase
      .from('jobs')
      .insert({
        type: 'render',
        status: 'generating',
        result: { alias, mindId, palId, prompt, lastFingerprint: fingerprint },
      })
      .select('id')
      .single();

    if (!job) throw new Error('Failed to create job');

    console.log(`[Render] Job ${job.id} started, alias: ${alias}`);
    res.json({ success: true, jobId: job.id, status: 'generating' });
  } catch (e: any) {
    console.error('[Render] POST error:', e);
    res.status(500).json({ error: e.message });
  }
});

// -----------------------------------------------------------------
// POST /api/admin/render/:jobId/continue – check for artifact
// -----------------------------------------------------------------
router.post('/render/:jobId/continue', async (req, res) => {
  try {
    const { jobId } = req.params;
    const { data: job } = await supabase.from('jobs').select('*').eq('id', jobId).single();
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (job.status === 'completed' || job.status === 'failed') {
      return res.json({ jobId: job.id, status: job.status, result: job.result, error: job.error });
    }

    const { alias, mindId, palId, lastFingerprint } = job.result;
    const history = await getHistory(alias, lastFingerprint);
    console.log(`[Render ${jobId}] Fetched ${history.length} messages`);

    const replies = history.filter((m: any) => m.role !== 'user' && m.role !== 'system');
    if (replies.length === 0) {
      console.log(`[Render ${jobId}] No reply yet.`);
      return res.json({ jobId, status: 'generating' });
    }

    const replyText = replies[replies.length - 1].messageText || '';
    console.log(`[Render ${jobId}] Reply: ${replyText.substring(0, 200)}`);

    // Look for artifact:// link
    const artifactMatch = replyText.match(/artifact:\/\/([a-f0-9-]+)/);
    if (!artifactMatch) {
      await supabase.from('jobs').update({
        status: 'failed',
        error: 'No artifact:// link in reply.',
        result: { ...job.result, reply: replyText },
      }).eq('id', jobId);
      return res.json({ jobId, status: 'failed', reply: replyText });
    }

    const artifactId = artifactMatch[1];
    console.log(`[Render ${jobId}] Found artifact ID: ${artifactId}`);

    // Extract attachment
    const lastReply = replies[replies.length - 1];
    const attachments = lastReply.attachments || [];
    const attachment = attachments.find((att: any) => att.artifactId === artifactId);
    if (!attachment || !attachment.artifact) {
      await supabase.from('jobs').update({
        status: 'failed',
        error: 'Artifact not found in attachments.',
        result: { ...job.result, reply: replyText },
      }).eq('id', jobId);
      return res.json({ jobId, status: 'failed', error: 'Artifact missing from attachments' });
    }

    console.log(`[Render ${jobId}] Artifact found, type: ${attachment.mimeType}, size: ${attachment.artifact?.length || 0}`);

    // Upload to Supabase Storage
    const imageBuffer = Buffer.from(attachment.artifact, 'base64');
    const mimeType = attachment.mimeType || 'image/png';
    const extension = attachment.extension || (mimeType === 'image/png' ? 'png' : 'jpg');
    const fileName = `${palId}/${Date.now()}.${extension}`;

    const { error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(fileName, imageBuffer, { contentType: mimeType, upsert: true });

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

    console.log(`[Render ${jobId}] Completed! Avatar: ${avatarUrl}`);
    res.json({ jobId, status: 'completed', avatarUrl });

  } catch (e: any) {
    console.error(`[Render] Continue error:`, e);
    res.status(500).json({ error: e.message });
  }
});

export default router;