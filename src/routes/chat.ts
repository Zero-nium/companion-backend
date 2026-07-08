import { Router } from 'express';
import { supabase } from '../db.js';
import { sendAndWaitReply } from '../services/minds.js';

const router = Router();

// -----------------------------------------------------------------
// POST /api/chat
// Body: { palId: string, message: string }
// -----------------------------------------------------------------
router.post('/chat', async (req, res) => {
  try {
    const { palId, message } = req.body;
    if (!palId || !message) return res.status(400).json({ error: 'palId and message are required' });

    // 1. Load pal's DNA
    const { data: pal } = await supabase
      .from('pals')
      .select('preference_dna, personality_dna, mind_email')
      .eq('id', palId)
      .single();

    if (!pal) return res.status(404).json({ error: 'Pal not found' });

    // 2. Build the compact Personality Anchor
    const anchor = buildAnchor(pal.personality_dna);

    // 3. Stable conversation alias (one thread per pal per user)
    const alias = `conv-${palId}`;

    // 4. Minimal system prompt – safety is in DNA/TENET
    const systemPrompt = `You are speaking to your steward. Adhere to your safety covenant in TENET companion.safety. Your personality anchor: ${anchor}`;

    // 5. Send to the agent
    const mindId = pal.mind_email.split('@')[0];
    const reply = await sendAndWaitReply(alias, mindId, `${systemPrompt}\n\nUser: ${message}`, 120_000);

    res.json({ reply });
  } catch (e: any) {
    console.error('[chat] Error:', e);
    res.status(500).json({ error: e.message });
  }
});

// -----------------------------------------------------------------
// Compact Personality Anchor (from structured DNA)
// -----------------------------------------------------------------
function buildAnchor(pdna: any): string {
  if (!pdna) return '';

  const ct = pdna.core_traits || {};
  const ss = pdna.speech_style || {};
  const er = pdna.emotional_range || {};
  const quirks = pdna.quirks || [];

  const formality = ss.formality < 0.4 ? 'casual' : 'formal';
  const verbosity = ss.verbosity < 0.4 ? 'terse' : 'chatty';

  let anchor = `Traits: O${ct.openness} C${ct.conscientiousness} E${ct.extraversion} A${ct.agreeableness} S${ct.emotional_stability}. `;
  anchor += `Speech: ${formality}, ${verbosity}, humor ${ss.humor_style || 'none'}, flow ${ss.sentence_flow || 'natural'}. `;
  anchor += `Emotion: ${er.primary_affect || 'warm'}, empathy ${er.empathy_expression || 'supportive'}. `;
  if (quirks.length) anchor += `Quirks: ${quirks.join('; ')}.`;

  return anchor;
}

export default router;