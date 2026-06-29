import { Router } from 'express';
import { supabase } from '../db.js';
import { getClient, ensureConversation, sendMessage, getHistory, getLatestFingerprint } from '../services/minds.js';

const router = Router();
const ADMIN_KEY = process.env.ADMIN_KEY || 'dev-secret';

// ---------------------------------------------------------------
// POST /api/admin/genesis – start the Genesis sequence
// ---------------------------------------------------------------
router.post('/genesis', async (req, res) => {
  try {
    const { adminKey, mindId } = req.body;
    if (adminKey !== ADMIN_KEY) return res.status(403).json({ error: 'Unauthorized' });
    if (!mindId) return res.status(400).json({ error: 'mindId is required' });

    // Create a new job
    const { data: job } = await supabase
      .from('jobs')
      .insert({ type: 'genesis', status: 'visual_dna_sent' })
      .select('id')
      .single();
    if (!job) throw new Error('Failed to create job');

    // Initialise Minds conversation
    const alias = `genesis-${job.id}`;
    await ensureConversation(alias, mindId);

    // Send Visual DNA request
    const visualPrompt = getVisualDnaPrompt();
    await sendMessage(alias, mindId, visualPrompt);

    // Store the conversation state (alias + fingerprint so we can detect new replies)
    const fingerprint = await getLatestFingerprint(alias);
    await supabase.from('jobs').update({
      status: 'visual_dna_sent',
      result: { alias, lastFingerprint: fingerprint, mindId, step: 'visual_dna' },
    }).eq('id', job.id);

    res.json({ success: true, jobId: job.id, status: 'visual_dna_sent' });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------
// POST /api/admin/genesis/:jobId/continue – advance to next step
// ---------------------------------------------------------------
// GET /api/admin/genesis/:jobId – check job status
router.get('/genesis/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;
    const { data: job } = await supabase
      .from('jobs')
      .select('*')
      .eq('id', jobId)
      .single();

    if (!job) return res.status(404).json({ error: 'Job not found' });

    res.json({
      jobId: job.id,
      status: job.status,
      result: job.result,
      error: job.error,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/genesis/:jobId/continue', async (req, res) => {
  try {
    const { jobId } = req.params;
    const { data: job } = await supabase.from('jobs').select('*').eq('id', jobId).single();
    if (!job) return res.status(404).json({ error: 'Job not found' });

    if (job.status === 'completed' || job.status === 'failed') {
      return res.json({ jobId: job.id, status: job.status, result: job.result, error: job.error });
    }

    // Run the next step based on current status
    const updatedJob = await advanceJob(job);
    res.json({
      jobId: updatedJob.id,
      status: updatedJob.status,
      result: updatedJob.result,
      error: updatedJob.error,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------
// Background logic: advance the job one step
// ---------------------------------------------------------------
async function advanceJob(job: any): Promise<any> {
  const { id, result } = job;
  const { alias, lastFingerprint, mindId, step } = result;

  // Check for new messages since last fingerprint
  const client = await getClient();
  const history = await getHistory(alias, lastFingerprint);
  console.log(`[Job ${job.id}] Fetched ${history.length} messages since fingerprint "${lastFingerprint}"`);
  history.forEach((m: any, i: number) => {
    console.log(`[Job ${job.id}]   [${i}] role=${m.role}, text=${m.messageText?.substring(0, 80)}...`);
  });
  const replies = (history as any[]).filter(
    (m: any) => m.role !== 'user' && m.role !== 'system'
  );
  console.log(`[Job ${job.id}] Found ${replies.length} replies from Mind.`);
  if (replies.length === 0) {
    // No reply yet – nothing to do
    return job;
  }

  // Take the latest reply
  const reply = replies[replies.length - 1];
  const replyText = reply.messageText || '';

  // Figure out which step we're on
  if (step === 'visual_dna') {
    return processVisualDna(job, alias, mindId, replyText);
  } else if (step === 'personality') {
    return processPersonality(job, alias, mindId, replyText);
  } else if (step === 'render') {
    return processRender(job, alias, mindId, replyText);
  }

  return job;
}

// ---------------------------------------------------------------
// Step handlers
// ---------------------------------------------------------------
async function processVisualDna(job: any, alias: string, mindId: string, replyText: string): Promise<any> {
  // Strip HTML tags and decode entities
  const cleanedText = replyText
    .replace(/<[^>]*>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();

  // First try to find a JSON code block
  let jsonStr = '';
  const codeMatch = cleanedText.match(/```json\s*([\s\S]*?)\s*```/);
  if (codeMatch) {
    jsonStr = codeMatch[1];
  } else {
    // No code block – try the entire text as JSON
    if (cleanedText.startsWith('{') || cleanedText.startsWith('[')) {
      jsonStr = cleanedText;
    }
  }

  if (!jsonStr) {
    console.log(`[Job ${job.id}] No JSON found in reply. Asking for resubmit.`);
    await sendMessage(alias, mindId, 'Please reply with ONLY the JSON object inside a code block (```json ... ```). No other text.');
    const fingerprint = await getLatestFingerprint(alias);
    return supabase.from('jobs').update({
      status: 'visual_dna_sent',
      result: { ...job.result, lastFingerprint: fingerprint }
    }).eq('id', job.id).select('*').single();
  }

  try {
    const preferenceDna = JSON.parse(jsonStr);
    console.log(`[Job ${job.id}] Visual DNA parsed successfully. Sending personality request...`);

    // Send Personality Statement request
    const personalityPrompt = getPersonalityPrompt();
    await sendMessage(alias, mindId, personalityPrompt);
    const fingerprint = await getLatestFingerprint(alias);

    const { data: updatedJob } = await supabase.from('jobs').update({
      status: 'personality_sent',
      result: { ...job.result, step: 'personality', lastFingerprint: fingerprint, preferenceDna },
    }).eq('id', job.id).select('*').single();

    console.log(`[Job ${job.id}] Advanced to personality_sent.`);
    return updatedJob;
  } catch (parseError: any) {
    console.error(`[Job ${job.id}] JSON parse error:`, parseError.message);
    // Ask for correction
    await sendMessage(alias, mindId, `Your JSON is invalid: ${parseError.message}. Please fix and resubmit using a code block with three backticks and the word json, like this:

      \`\`\`json
      { ... your corrected JSON ... }
      \`\`\``);
    const fingerprint = await getLatestFingerprint(alias);
    return supabase.from('jobs').update({
      status: 'visual_dna_sent',
      result: { ...job.result, lastFingerprint: fingerprint }
    }).eq('id', job.id).select('*').single();
  }
}

async function processPersonality(job: any, alias: string, mindId: string, replyText: string): Promise<any> {
  // Send Render request
  console.log(`[Job ${job.id}] Processing Visual DNA reply...`);
  const renderPrompt = getRenderPrompt();
  await sendMessage(alias, mindId, renderPrompt);
  const fingerprint = await getLatestFingerprint(alias);

  const { data: updatedJob } = await supabase.from('jobs').update({
    status: 'render_sent',
    result: {
      ...job.result,
      step: 'render',
      lastFingerprint: fingerprint,
      personalityStatement: replyText.replace(/<[^>]*>/g, ''),
    },
  }).eq('id', job.id).select('*').single();

  return updatedJob;
}

async function processRender(job: any, alias: string, mindId: string, replyText: string): Promise<any> {
  // Genesis complete – store everything
  console.log(`[Job ${job.id}] Processing Visual DNA reply...`);
  const { preferenceDna, personalityStatement } = job.result;
  const { data: pal } = await supabase
    .from('pals')
    .insert({
      mind_email: `${mindId}@hellominds.ai`,
      display_name: preferenceDna.display_name,
      preference_dna: preferenceDna,
      personality_statement: personalityStatement,
      render_prompt: replyText,
      status: 'genesis_complete',
    })
    .select('id')
    .single();

  const { data: updatedJob } = await supabase.from('jobs').update({
    status: 'completed',
    result: {
      ...job.result,
      palId: pal?.id,
      renderPrompt: replyText,
    },
    completed_at: new Date().toISOString(),
    pal_id: pal?.id,
  }).eq('id', job.id).select('*').single();

  return updatedJob;
}

// ---------------------------------------------------------------
// Helper prompts
// ---------------------------------------------------------------
function getVisualDnaPrompt(): string {
  return `You are creating your visual identity. Reply with ONLY a JSON object inside a code block (\`\`\`json ... \`\`\`). Do not add any other text.

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
}

function getPersonalityPrompt(): string {
  return `Write a description of your personality, quirks, and how you relate to others. This will shape your soul and cannot be changed later. Write between 200 and 500 words in plain text. Do not include any formatting.`;
}

function getRenderPrompt(): string {
  return `Based on your visual DNA and personality, write a single, highly detailed prompt for an anime-style character illustration. Follow the style lock: anime style, clean lineart, cel-shaded, soft gradients, high detail eyes. Do NOT include text, watermarks, or NSFW elements. Return ONLY the prompt.`;
}

export default router;