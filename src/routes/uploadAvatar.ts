import { Router } from 'express';
import { supabase } from '../db.js';

const router = Router();
const UPLOAD_SECRET = process.env.UPLOAD_SECRET || 'dev-upload-secret';

router.post('/upload-avatar', async (req, res) => {
  try {
    const { secret, mindId, base64Image } = req.body;
    if (secret !== UPLOAD_SECRET) return res.status(403).json({ error: 'Unauthorized' });

    if (!mindId || !base64Image) {
      return res.status(400).json({ error: 'mindId and base64Image are required' });
    }

    // Upload to Supabase
    const imageBuffer = Buffer.from(base64Image, 'base64');
    const fileName = `${mindId}/portrait-${Date.now()}.png`;
    const { error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(fileName, imageBuffer, { contentType: 'image/png', upsert: true });
    if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);

    const { data: publicUrl } = supabase.storage.from('avatars').getPublicUrl(fileName);
    const avatarUrl = publicUrl.publicUrl;

    // Update pal record (assuming mind_email = mindId@hellominds.ai)
    const email = `${mindId}@hellominds.ai`;
    await supabase.from('pals').update({ avatar_url: avatarUrl }).eq('mind_email', email);

    res.json({ success: true, avatarUrl });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;