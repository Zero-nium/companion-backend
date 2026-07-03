import { Router } from 'express';
import { supabase } from '../db.js';

const router = Router();
const SECRET = process.env.UPLOAD_SECRET || 'dev-upload-secret';

router.post('/set-avatar-url', async (req, res) => {
  try {
    const { secret, mindId, avatarUrl } = req.body;
    if (secret !== SECRET) return res.status(403).json({ error: 'Unauthorized' });

    if (!mindId || !avatarUrl) return res.status(400).json({ error: 'mindId and avatarUrl are required' });

    const email = `${mindId}@hellominds.ai`;
    const { data: pal } = await supabase.from('pals').select('id').eq('mind_email', email).single();
    if (!pal) return res.status(404).json({ error: 'Pal not found. Submit DNA first.' });

    await supabase.from('pals').update({ avatar_url: avatarUrl }).eq('id', pal.id);
    res.json({ success: true, avatarUrl });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;