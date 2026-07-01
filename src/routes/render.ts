import { Router } from 'express';
import { supabase } from '../db.js';
import { ensureConversation, sendMessage, getHistory, getClient } from '../services/minds.js';

const router = Router();
const ADMIN_KEY = process.env.ADMIN_KEY || 'dev-secret';

// POST /api/admin/render – start image generation in background
router.post('/render', async (req, res) => {
  try {
    const { adminKey, palId, prompt } = req.body;
    if (adminKey !== ADMIN_KEY) return res.status(403).json({ error: 'Unauthorized' });

    // Get the mindId for this pal
    const { data: pal } = await supabase.from('pals').select('mind_email').eq('id', palId).single();
    if (!pal) return res.status(404).json({ error: 'Pal not found' });

    const mindId = pal.mind_email.split('@')[0];

    // Create a job record
    const { data: job } = await supabase
      .from('jobs')
      .insert({ type: 'render', status: 'generating', result: { mindId, palId, prompt } })
      .select('id')
      .single();

    if (!job) throw new Error('Failed to create job');

    // Run the generation in background (no waiting)
    runRenderJob(job.id, mindId, palId, prompt).catch((err) => {
      console.error(`[Render] Job ${job.id} failed:`, err);
      supabase
        .from('jobs')
        .update({ status: 'failed', error: err.message, completed_at: new Date().toISOString() })
        .eq('id', job.id);
    });

    res.json({ success: true, jobId: job.id, status: 'generating' });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/admin/render/:jobId – check status
router.get('/render/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;
    const { data: job } = await supabase.from('jobs').select('*').eq('id', jobId).single();
    if (!job) return res.status(404).json({ error: 'Job not found' });

    res.json({ jobId: job.id, status: job.status, result: job.result, error: job.error });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// -----------------------------------------------------------------
// Background function
// -----------------------------------------------------------------
async function runRenderJob(jobId: string, mindId: string, palId: string, prompt: string) {
  console.log(`[Render ${jobId}] Starting background render...`);

  const alias = `render-${Date.now()}`;
  const { ensureConversation, sendMessage, getHistory, getLatestFingerprint } = await import('../services/minds.js');

  // Ensure conversation and send the image request
  await ensureConversation(alias, mindId);
  await sendMessage(alias, mindId, `Generate an image using the following prompt and return it as an attachment:\n\n${prompt}`);
  console.log(`[Render ${jobId}] Message sent. Waiting for reply...`);

  // Poll every 30 seconds for a reply (up to 30 minutes)
  const maxAttempts = 60; // 60 * 30s = 30 minutes
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 30_000));
    console.log(`[Render ${jobId}] Polling attempt ${attempt + 1}...`);

    // Fetch recent history (no fingerprint) to catch any reply
    const history = await getHistory(alias, undefined, 10);
    const replies = history.filter((m: any) => m.role !== 'user' && m.role !== 'system');
    if (replies.length === 0) continue;

    const replyText = replies[replies.length - 1].messageText || '';
    console.log(`[Render ${jobId}] Reply found: ${replyText.substring(0, 200)}`);

    // Look for artifact:// link
    const artifactMatch = replyText.match(/artifact:\/\/([a-f0-9-]+)/);
    if (!artifactMatch) {
      throw new Error('No artifact:// link in reply');
    }
    const artifactId = artifactMatch[1];

    // Find the attachment in history
    const attachmentMessage = history.find((m: any) => m.artifactId === artifactId);
    if (!attachmentMessage || !attachmentMessage.attachments) {
      throw new Error('Attachment not found in history');
    }
    const attachment = attachmentMessage.attachments.find((att: any) => att.artifactId === artifactId);
    if (!attachment || !attachment.artifact) {
      throw new Error('Artifact body not found');
    }

    console.log(`[Render ${jobId}] Artifact found, type: ${attachment.mimeType}, size: ${attachment.artifact.length}`);

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

    // Update pal and job
    await supabase.from('pals').update({ avatar_url: avatarUrl }).eq('id', palId);
    await supabase.from('jobs').update({
      status: 'completed',
      result: { avatarUrl, palId },
      pal_id: palId,
      completed_at: new Date().toISOString(),
    }).eq('id', jobId);

    console.log(`[Render ${jobId}] Completed! Avatar: ${avatarUrl}`);
    return; // success – exit loop
  }

  // If we exit the loop without returning, it means we never got a reply
  throw new Error('Poly did not reply within 30 minutes.');
}

export default router;