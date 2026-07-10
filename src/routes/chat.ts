import { Router } from 'express';
import { supabase } from '../db.js';
import { sendAndWaitReply } from '../services/minds.js';

const router = Router();

router.post('/chat', async (req, res) => {
  try {
    const { palId, message, sessionId } = req.body;
    if (!palId || !message) return res.status(400).json({ error: 'palId and message are required' });

    // Load pal
    const { data: pal } = await supabase
      .from('pals')
      .select('personality_dna, mind_email')
      .eq('id', palId)
      .single();

    if (!pal) return res.status(404).json({ error: 'Pal not found' });

    // Store user message
    const userMsg = {
      pal_id: palId,
      direction: 'user_to_pal',
      content: message,
      session_id: sessionId || 'default',
    };
    await supabase.from('messages').insert(userMsg);

    // Build prompt and send
    const anchor = buildAnchor(pal.personality_dna);
    const alias = `chat-${palId}-${Date.now()}`;
    const mindId = pal.mind_email.split('@')[0];

    const systemPrompt = `Personality anchor: ${anchor}`;
    const fullPrompt = `${systemPrompt}\n\nUser: ${message}`;

    const reply = await sendAndWaitReply(alias, mindId, fullPrompt, 180_000);

    // Store pal reply
    const palMsg = {
      pal_id: palId,
      direction: 'pal_to_user',
      content: reply,
      session_id: sessionId || 'default',
    };
    await supabase.from('messages').insert(palMsg);

    res.json({ reply });
  } catch (e: any) {
    console.error('[chat] Error:', e);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/chat/:palId/messages – retrieve chat history
router.get('/chat/:palId/messages', async (req, res) => {
  try {
    const { palId } = req.params;
    const { sessionId, limit = '50', before } = req.query;

    let query = supabase
      .from('messages')
      .select('*')
      .eq('pal_id', palId)
      .order('timestamp', { ascending: true })
      .limit(parseInt(limit as string, 10));

    if (sessionId) query = query.eq('session_id', sessionId);
    if (before) query = query.lt('timestamp', before);

    const { data: messages, error } = await query;
    if (error) throw new Error(error.message);

    res.json({ messages });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

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