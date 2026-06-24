import { Router, Request, Response } from 'express';
import { supabase } from '../db';
import { sendEmailToAgent } from '../services/email';
import crypto from 'crypto';

const router = Router();

router.post('/inbound', async (req: Request, res: Response) => {
  try {
    const { from, to, subject, text } = req.body;
    console.log('Inbound email:', { from, subject });

    // Find pal by email
    const { data: pal, error } = await supabase
      .from('pals')
      .select('*')
      .eq('mind_email', from)
      .single();

    if (!pal) {
      console.log('No pal found for', from);
      return res.status(200).send('OK');
    }

    // Check if this is a Genesis response
    if (subject.startsWith('Re: GENESIS:')) {
      await handleGenesisReply(pal, subject, text);
    } else {
      // Normal chat reply – will be implemented later
      console.log('Chat reply from', from, ':', text);
    }

    res.status(200).send('OK');
  } catch (err) {
    console.error('Inbound error:', err);
    res.status(200).send('OK'); // still return 200 to Resend
  }
});

async function handleGenesisReply(pal: any, subject: string, text: string) {
  if (subject.includes('Visual DNA')) {
    // Extract JSON block
    const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
    if (!jsonMatch) {
      // Ask agent to fix formatting
      await requestResubmit(pal, 'visual_dna', 'Please use a JSON code block (```json ... ```).');
      return;
    }

    try {
      const dna = JSON.parse(jsonMatch[1]);
      // Basic validation
      if (!dna.display_name || !dna.primary_archetype) {
        await requestResubmit(pal, 'visual_dna', 'Missing required fields (display_name, primary_archetype).');
        return;
      }

      await supabase
        .from('pals')
        .update({
          preference_dna: dna,
          display_name: dna.display_name,
          status: 'visual_dna_received'
        })
        .eq('id', pal.id);

      console.log('Visual DNA saved for', pal.id);

      // Trigger next step: Personality Statement
      await sendPersonalityRequest(pal);
    } catch (e) {
      console.error('JSON parse error:', e);
      await requestResubmit(pal, 'visual_dna', 'Invalid JSON. Please check syntax.');
    }
  } else if (subject.includes('Personality Statement')) {
    // Store raw statement and trigger interpretation
    const statement = text.trim();
    await supabase
      .from('pals')
      .update({
        personality_statement: statement,
        status: 'personality_received'
      })
      .eq('id', pal.id);

    console.log('Personality statement received for', pal.id);

    // Here we would run the interpretation pipeline (Task B next)
    // For now, just log it and move to render
    await sendRenderRequest(pal);
  } else if (subject.includes('Image Render')) {
    // Agent replied with image prompt
    const prompt = text.trim();
    // Store and trigger render (will implement after image gen integration)
    console.log('Image prompt received:', prompt);
    await supabase
      .from('pals')
      .update({
        render_prompt: prompt,
        status: 'render_prompt_received'
      })
      .eq('id', pal.id);
  }
}

async function requestResubmit(pal: any, step: string, reason: string) {
  const messageId = crypto.randomUUID();
  const subject = `GENESIS: Correction Request [${pal.id}]`;
  const body = `Your last submission had a problem: ${reason}\n\nPlease reply again with the corrected format.`;
  await sendEmailToAgent(
    pal.mind_email,
    `genesis@${process.env.PROXY_DOMAIN}`,
    subject,
    body.replace(/\n/g, '<br>'),
    messageId
  );
}

async function sendPersonalityRequest(pal: any) {
  const messageId = crypto.randomUUID();
  await sendEmailToAgent(
    pal.mind_email,
    `genesis@${process.env.PROXY_DOMAIN}`,
    `GENESIS: Personality Statement [${pal.id}]`,
    'Write a description of your personality, quirks, and how you relate to others. This will shape your soul and cannot be changed later. Write between 200 and 500 words in plain text. Do not include any formatting or signatures.',
    messageId
  );
  await supabase.from('pals').update({ status: 'personality_requested' }).eq('id', pal.id);
}

async function sendRenderRequest(pal: any) {
  const messageId = crypto.randomUUID();
  await sendEmailToAgent(
    pal.mind_email,
    `genesis@${process.env.PROXY_DOMAIN}`,
    `GENESIS: Image Render Request [${pal.id}]`,
    'Based on your visual DNA and personality, write a single, highly detailed prompt for an anime-style character illustration. Follow the style lock: anime style, clean lineart, cel-shaded, soft gradients, high detail eyes. Do NOT include text, watermarks, or NSFW elements. Return ONLY the prompt.',
    messageId
  );
  await supabase.from('pals').update({ status: 'render_requested' }).eq('id', pal.id);
}

export default router;