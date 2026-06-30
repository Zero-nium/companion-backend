import { Router } from 'express';
import { supabase } from '../db.js';
import { ensureConversation, sendMessage, getLatestFingerprint, getHistory, getClient } from '../services/minds.js';

const router = Router();
const ADMIN_KEY = process.env.ADMIN_KEY || 'dev-secret';

// POST /api/admin/render – start an image generation job
router.post('/render', async (req, res) => {
  try {
    const { adminKey, palId, prompt } = req.body;
    if (adminKey !== ADMIN_KEY) return res.status(403).json({ error: 'Unauthorized' });

    // Get the mindId for this pal
    const { data: pal } = await supabase.from('pals').select('mind_email').eq('id', palId).single();
    if (!pal) return res.status(404).json({ error: 'Pal not found' });

    const mindId = pal.mind_email.split('@')[0]; // or store mindId directly – we'll adapt
    const alias = `render-${palId}-${Date.now()}`;

    await ensureConversation(alias, mindId);
    await sendMessage(alias, mindId, `Generate an image using the following prompt and return it as an attachment:\n\n${prompt}`);
    const fingerprint = await getLatestFingerprint(alias);

    const { data: job } = await supabase.from('jobs')
      .insert({
        type: 'render',
        status: 'generating',
        result: { alias, mindId, palId, prompt, lastFingerprint: fingerprint },
      })
      .select('id')
      .single();

    res.json({ success: true, jobId: job!.id, status: 'generating' });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/render/:jobId/continue – check for artifact
router.post('/render/:jobId/continue', async (req, res) => {
  try {
    const { jobId } = req.params;
    const { data: job } = await supabase.from('jobs').select('*').eq('id', jobId).single();
    if (!job) return res.status(404).json({ error: 'Job not found' });

    if (job.status === 'completed' || job.status === 'failed') {
      return res.json({ jobId: job.id, status: job.status, result: job.result, error: job.error });
    }

    const { alias, mindId, palId, lastFingerprint, prompt } = job.result;
    const client = await getClient();
    const history = await getHistory(alias, lastFingerprint);

    // Find messages with artifacts
    const artifacts = history.filter((m: any) => m.artifact);
    if (artifacts.length === 0) {
      // No artifact yet – check if Poly replied with an error or text
      const replies = history.filter((m: any) => m.role !== 'user' && m.role !== 'system');
      if (replies.length > 0) {
        // She replied, but no artifact. Mark as failed with the reply.
        await supabase.from('jobs').update({
          status: 'failed',
          error: 'Poly replied without an artifact.',
          result: { ...job.result, reply: replies[0].messageText },
        }).eq('id', jobId);
        return res.json({ jobId, status: 'failed', reply: replies[0].messageText });
      }
      return res.json({ jobId, status: 'generating' });
    }

    // Pick the first artifact
    const artifact = artifacts[0];
    console.log(`[Render ${jobId}] Artifact found: type=${artifact.mimeType}, size=${artifact.artifact?.length || 0}`);

    // Decode base64 to buffer
    const imageBuffer = Buffer.from(artifact.artifact, 'base64');
    const extension = artifact.extension || 'png';
    const fileName = `${palId}/${Date.now()}.${extension}`;

    // Upload to Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(fileName, imageBuffer, { contentType: artifact.mimeType || 'image/png', upsert: true });

    if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);

    // Get public URL
    const { data: publicUrl } = supabase.storage.from('avatars').getPublicUrl(fileName);
    const avatarUrl = publicUrl.publicUrl;

    // Update pals table
    await supabase.from('pals').update({ avatar_url: avatarUrl }).eq('id', palId);

    // Mark job complete
    await supabase.from('jobs').update({
      status: 'completed',
      result: { ...job.result, avatarUrl },
      pal_id: palId,
      completed_at: new Date().toISOString(),
    }).eq('id', jobId);

    res.json({ jobId, status: 'completed', avatarUrl });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;