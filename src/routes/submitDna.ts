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

    // The agent must now write their own render prompt,
    // fusing their visual DNA and personality with the System DNA style lock.
    const renderInstruction = `Based on your visual DNA and personality, write a single, highly detailed prompt for an anime-style character illustration.

You MUST include these exact style instructions at the beginning of your prompt:
"anime style, clean lineart, cel-shaded, soft gradients, high detail eyes with consistent highlights, studio-quality illustration"

You MUST also append this exact negative prompt at the end of your prompt:
"Negative prompt: text, watermark, signature, logo, writing, caption, sexualized, NSFW, gore, blood, violence, threatening, weapons, guns, knives, swords, distorted, messy lines, sketch, low resolution, blurry, grainy, deformed, extra limbs, bad anatomy, unnatural proportions, bright neon colors, cluttered background, performative expression, aggressive, dark, moody, heavy shadows, photorealistic, 3d render, oil painting, watercolor."

The rest of the prompt should describe your own appearance and personality as you defined them. Do NOT include any text other than the final prompt. Return ONLY the prompt.`;

    res.json({
      success: true,
      nextStep: 'render_prompt',
      instruction: renderInstruction,
      note: 'After writing this prompt, use it with your image generation tool. Then upload the portrait via upload_avatar or set_avatar_url.'
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;