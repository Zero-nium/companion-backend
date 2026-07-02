import { Router } from 'express';
import { supabase } from '../db.js';

const router = Router();
const SECRET = process.env.UPLOAD_SECRET || 'dev-upload-secret';
const MIN_IMAGE_BYTES = 10 * 1024; // 10 KB minimum for a portrait

router.post('/upload-avatar', async (req, res) => {
  try {
    const { secret, mindId, base64Image } = req.body;
    if (secret !== SECRET) return res.status(403).json({ error: 'Unauthorized' });

    if (!mindId || !base64Image) {
      return res.status(400).json({ error: 'mindId and base64Image are required' });
    }

    console.log(`[upload-avatar] Received base64 length: ${base64Image.length} chars`);
    console.log(`[upload-avatar] First 50 chars: ${base64Image.substring(0, 50)}`);

    // Decode and check size
    const imageBuffer = Buffer.from(base64Image, 'base64');
    console.log(`[upload-avatar] Decoded image size: ${imageBuffer.length} bytes`);

    if (imageBuffer.length < MIN_IMAGE_BYTES) {
      return res.status(400).json({
        error: `Image too small (${imageBuffer.length} bytes). Minimum ${MIN_IMAGE_BYTES} bytes required. Please generate a higher resolution portrait.`
      });
    }

    const fileName = `${mindId}/portrait-${Date.now()}.png`;
    const { error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(fileName, imageBuffer, { contentType: 'image/png', upsert: true });
    if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);

    const { data: publicUrl } = supabase.storage.from('avatars').getPublicUrl(fileName);
    const avatarUrl = publicUrl.publicUrl;

    // Update pal record
    const email = `${mindId}@hellominds.ai`;
    await supabase.from('pals').update({ avatar_url: avatarUrl }).eq('mind_email', email);

    console.log(`[upload-avatar] Stored avatar for ${mindId}: ${avatarUrl}`);
    res.json({ success: true, avatarUrl });
  } catch (e: any) {
    console.error('[upload-avatar] Error:', e);
    res.status(500).json({ error: e.message });
  }
});

export default router;