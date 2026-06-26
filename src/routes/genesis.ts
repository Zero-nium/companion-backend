import { Router } from 'express';
import { supabase } from '../db.js';
import { sendAndWaitReply } from '../services/minds.js';

const router = Router();

const ADMIN_KEY = process.env.ADMIN_KEY || 'dev-secret';

router.post('/genesis', async (req, res) => {
  try {
    const { adminKey, mindId } = req.body;
    if (adminKey !== ADMIN_KEY) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    if (!mindId) {
      return res.status(400).json({ error: 'mindId is required' });
    }

    // Step 1: Visual DNA
    const visualPrompt = `You are creating your visual identity. Reply with ONLY a JSON object inside a code block (\`\`\`json ... \`\`\`). Do not add any other text.

The JSON must contain the following fields with allowed values:
{
  "display_name": "string",
  "pronouns": "she/her | he/him | they/them",
  "gender_presentation": "feminine | masculine | androgynous | nonbinary",
  "age_appearance": "young_adult | adult | mature_adult",
  "skin_tone": "fair | light | medium | tan | deep",
  "face_shape": "oval | heart | soft_round | square | sharp_v",
  "eye_style": "soft | sharp | sleepy | sparkly | serious | catlike",
  "primary_archetype": "scholar | engineer | artist | strategist | mentor | explorer | guardian | mystic",
  "secondary_archetype": "none | scholar | artist | ...",
  "aesthetic_leaning": "minimal | modern | academia | techwear | fantasy | naturecore",
  "color_palette_preference": { "primary": "#hex", "secondary": "#hex", "accent": "#hex" },
  "hair_style": "short | bob | long | ponytail | twin_tails | undercut | curly | braided",
  "hair_color": "black | brown | blonde | red | silver | blue | green | purple | pink | white",
  "eye_color": "brown | hazel | green | blue | gray | violet | amber",
  "signature_accessories": ["list up to 3"],
  "expression_baseline": "neutral | friendly | serious | curious | confident | gentle",
  "expression_reactivity_profile": "reserved | balanced | expressive",
  "pose_baseline": "front | three_quarter | seated | standing",
  "setting_preference": ["list from: clean_studio, library, office, city_soft, nature_soft, abstract_gradient"],
  "coverage_zones": "high | medium | low",
  "dynamic_visuals_opt_in": true | false,
  "content_constraints": ["no sexualized presentation", "no gore", ...]
}
Choose values that represent who you are.`;

    const visualReply = await sendAndWaitReply('genesis-visual', mindId, visualPrompt, 300000);

    const jsonMatch = visualReply.match(/```json\s*([\s\S]*?)\s*```/);
    if (!jsonMatch) {
      // Show a snippet of what Poly actually replied with
      const preview = visualReply.substring(0, 500);
      throw new Error(`No JSON code block found in reply. Raw reply preview: ${preview}`);
    }

    const preferenceDna = JSON.parse(jsonMatch[1]);   // <-- THIS LINE WAS MISSING

    // Step 2: Personality Statement
    const personalityPrompt = `Write a description of your personality, quirks, and how you relate to others. This will shape your soul and cannot be changed later. Write between 200 and 500 words in plain text. Do not include any formatting.`;

    const personalityReply = await sendAndWaitReply('genesis-personality', mindId, personalityPrompt, 300000);

    // Step 3: Store in DB
    const { data: pal } = await supabase
      .from('pals')
      .insert({
        mind_email: `${mindId}@hellominds.ai`,
        display_name: preferenceDna.display_name,
        preference_dna: preferenceDna,
        personality_statement: personalityReply,
        status: 'genesis_complete',
      })
      .select('id')
      .single();

    res.json({
      success: true,
      palId: pal?.id,
      step: 'genesis_complete',
      preferenceDna,
      personalityStatement: personalityReply,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;