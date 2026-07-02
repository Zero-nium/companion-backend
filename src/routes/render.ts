import { Router } from 'express';
import { supabase } from '../db.js';
import { sendAndWaitReply, getHistory } from '../services/minds.js';

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

  // Short alias to avoid Minds rejection
  const alias = `render-${Date.now()}`;
  const { sendAndWaitReply, getHistory } = await import('../services/minds.js');

  // Send and wait for reply (up to 20 minutes – image generation can be slow)
  const reply = await sendAndWaitReply(
    alias,
    mindId,
    `Generate an image using the following prompt and return it as an attachment:\n\n${prompt}`,
    1_200_000 // 20 minutes
  );

  console.log(`[Render ${jobId}] Reply received: ${reply.substring(0, 200)}`);

  // Extract artifact ID
  const artifactMatch = reply.match(/artifact:\/\/([a-f0-9-]+)/);
  if (!artifactMatch) {
    throw new Error('No artifact:// link found in reply');
  }
  const artifactId = artifactMatch[1];

  // Fetch the conversation history to get the attachment body
  const history = await getHistory(alias, undefined, 10);
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

  await supabase.from('pals').update({ avatar_url: avatarUrl }).eq('id', palId);
  await supabase.from('jobs').update({
    status: 'completed',
    result: { avatarUrl, palId },
    pal_id: palId,
    completed_at: new Date().toISOString(),
  }).eq('id', jobId);

  console.log(`[Render ${jobId}] Completed! Avatar: ${avatarUrl}`);
}

export default router;