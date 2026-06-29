import { Router } from 'express';
import { supabase } from '../db.js';
import { sendAndWaitReply } from '../services/minds.js';

const router = Router();

const ADMIN_KEY = process.env.ADMIN_KEY || 'dev-secret';

// POST /api/admin/genesis - start DNA compilation
router.post('/genesis', async (req, res) => {
  try {
    const { adminKey, mindId } = req.body;
    if (adminKey !== ADMIN_KEY) return res.status(403).json({ error: 'Unauthorized' });
    if (!mindId) return res.status(400).json({ error: 'mindId is required' });

    // Create a job record
    const { data: job } = await supabase
      .from('jobs')
      .insert({ type: 'genesis', status: 'pending' })
      .select('id')
      .single();

    if (!job) throw new Error('Failed to create job');

    // Run Genesis in background (do not await – we return immediately)
    runGenesisJob(job.id, mindId).catch((err) => {
      console.error(`Genesis job ${job.id} failed:`, err);
      supabase
        .from('jobs')
        .update({ status: 'failed', error: err.message, completed_at: new Date().toISOString() })
        .eq('id', job.id);
    });

    // Return the job ID so the client can poll
    res.json({ success: true, jobId: job.id, status: 'pending' });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/admin/genesis/:jobId - check status
router.get('/genesis/:jobId', async (req, res) => {
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
// Background function that performs the actual Genesis steps
// -----------------------------------------------------------------
async function runGenesisJob(jobId: string, mindId: string) {
  await supabase.from('jobs').update({ status: 'running' }).eq('id', jobId);

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

  console.log(`[Job ${jobId}] Requesting Visual DNA...`);
  const visualReply = await sendAndWaitReply('genesis-visual', mindId, visualPrompt, 600_000);
  console.log(`[Job ${jobId}] Visual DNA received.`);

  const jsonMatch = visualReply.match(/```json\s*([\s\S]*?)\s*```/);
  if (!jsonMatch) {
    throw new Error(`No JSON code block. Reply preview: ${visualReply.substring(0, 500)}`);
  }
  const preferenceDna = JSON.parse(jsonMatch[1]);

  // Step 2: Personality Statement
  const personalityPrompt = `Write a description of your personality, quirks, and how you relate to others. This will shape your soul and cannot be changed later. Write between 200 and 500 words in plain text. Do not include any formatting.`;

  console.log(`[Job ${jobId}] Requesting Personality Statement...`);
  const personalityReply = await sendAndWaitReply('genesis-personality', mindId, personalityPrompt, 600_000);
  console.log(`[Job ${jobId}] Personality received.`);

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

  // Mark job as completed
  await supabase
    .from('jobs')
    .update({
      status: 'completed',
      result: {
        palId: pal?.id,
        preferenceDna,
        personalityStatement: personalityReply,
      },
      pal_id: pal?.id,
      completed_at: new Date().toISOString(),
    })
    .eq('id', jobId);

  console.log(`[Job ${jobId}] Genesis completed.`);
}

export default router;