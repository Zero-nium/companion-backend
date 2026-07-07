import { Router } from 'express';
import { supabase } from '../db.js';

const router = Router();
const SECRET = process.env.UPLOAD_SECRET || 'dev-upload-secret';

router.post('/submit-personality', async (req, res) => {
  try {
    const { secret, mindId, personalityDna } = req.body;
    if (secret !== SECRET) return res.status(403).json({ error: 'Unauthorized' });

    if (!mindId || !personalityDna) {
      return res.status(400).json({ error: 'mindId and personalityDna are required' });
    }

    // Basic validation: required fields present
    if (!personalityDna.core_traits || !personalityDna.social_orientation || !personalityDna.speech_style) {
      return res.status(400).json({ error: 'personalityDna must contain core_traits, social_orientation, speech_style' });
    }

    const email = `${mindId}@hellominds.ai`;
    const { data: pal } = await supabase.from('pals').select('id').eq('mind_email', email).single();
    if (!pal) return res.status(404).json({ error: 'Pal not found. Submit DNA first.' });

    await supabase.from('pals').update({ personality_dna: personalityDna }).eq('id', pal.id);

    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;