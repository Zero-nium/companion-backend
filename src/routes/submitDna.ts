import { Router } from 'express';
import { supabase } from '../db.js';

const router = Router();
const SECRET = process.env.UPLOAD_SECRET || 'dev-upload-secret';

router.post('/submit-dna', async (req, res) => {
  try {
    const { secret, mindId, visualDna, personalityStatement } = req.body;
    if (secret !== SECRET) return res.status(403).json({ error: 'Unauthorized' });

    if (!mindId || !visualDna || !personalityStatement) {
      return res.status(400).json({ error: 'mindId, visualDna, personalityStatement are required' });
    }

    // Validate critical DNA fields
    if (!visualDna.display_name || !visualDna.primary_archetype) {
      return res.status(400).json({
        error: 'Missing required fields: display_name and primary_archetype are mandatory.'
      });
    }

    const email = `${mindId}@hellominds.ai`;

    // Upsert pal record
    const { data: existing } = await supabase.from('pals').select('id').eq('mind_email', email).single();
    if (existing) {
      await supabase.from('pals').update({
        display_name: visualDna.display_name,
        preference_dna: visualDna,
        personality_statement: personalityStatement,
        status: 'dna_submitted',
      }).eq('id', existing.id);
    } else {
      await supabase.from('pals').insert({
        mind_email: email,
        display_name: visualDna.display_name,
        preference_dna: visualDna,
        personality_statement: personalityStatement,
        status: 'dna_submitted',
      });
    }

    // Generate render prompt (robust version from Poly's Genesis)
    const rp = visualDna;
    const prompt = `High-quality anime illustration of ${rp.display_name}, a ${rp.gender_presentation} adult with ${rp.face_shape} face, ${rp.hair_color} ${rp.hair_style}, ${rp.eye_color} ${rp.eye_style} eyes. ${rp.aesthetic_leaning} attire in ${rp.color_palette_preference.primary} and ${rp.color_palette_preference.secondary}. Expression: ${rp.expression_baseline}. Style: anime, clean lineart, cel-shaded.`;

    res.json({ success: true, renderPrompt: prompt });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;