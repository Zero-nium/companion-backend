import { Router } from 'express';
import { supabase } from '../db.js';
import { sendAndWaitReply, getHistory } from '../services/minds.js';

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

    // 2. Build the compact Personality Anchor + Companion Boundary
    const anchor = buildAnchor(pal.personality_dna);

    // 3. Stable conversation alias (one thread per pal)
    const alias = `conv-${palId}`;

    // 4. Fetch recent conversation history (last 10 messages)
    const historyText = await getRecentHistory(alias);

    // 5. Minimal system prompt – safety is in TENET invariant
    const systemPrompt = `You are speaking to your steward. Adhere to your safety invariants (TENET invariant bucket, key safety.invariant.v1). Your personality anchor and companion boundary: ${anchor}`;

    // 6. Combine history + new message
    const fullPrompt = [systemPrompt, historyText, `User: ${message}`].filter(Boolean).join('\n\n');

    // 7. Send to the agent
    const mindId = pal.mind_email.split('@')[0];
    const reply = await sendAndWaitReply(alias, mindId, fullPrompt, 120_000);

    res.json({ reply });
  } catch (e: any) {
    console.error('[chat] Error:', e);
    res.status(500).json({ error: e.message });
  }
});

// -----------------------------------------------------------------
// Get recent conversation history (last 10 messages)
// -----------------------------------------------------------------
async function getRecentHistory(alias: string, limit = 10): Promise<string> {
  try {
    const history = await getHistory(alias, undefined, limit);
    if (!history || history.length === 0) return '';
    return history
      .map((m: any) => `${m.role === 'user' ? 'User' : 'You'}: ${m.messageText}`)
      .join('\n');
  } catch {
    return ''; // if history fetch fails, just proceed without it
  }
}

// -----------------------------------------------------------------
// Compact Personality Anchor + Companion Boundary
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
  if (quirks.length) anchor += `Quirks: ${quirks.join('; ')}. `;

  // Companion boundary – prevents agent‑like service offers
  anchor += `COMPANION BOUNDARY: You are a companion for conversation and emotional presence only. `;
  anchor += `Never offer to manage calendars, send emails, set up OAuth, call tools, or perform any assistant-like tasks. `;
  anchor += `If asked for such services, decline gently and remind the steward you're here to talk, not to act.`;

  return anchor;
}

export default router;