import { Router } from 'express';
import { supabase } from '../db.js';
import { ensureConversation, sendMessage } from '../services/minds.js';

const router = Router();
const SECRET = process.env.UPLOAD_SECRET || 'dev-upload-secret';

// POST /api/admin/spaces — activate a World Seed into a Space
// Temporary test route
router.get('/spaces-test', (req, res) => {
  res.json({ message: 'spaces route is working' });
});
// POST /api/admin/spaces — activate a World Seed into a Space
router.post('/spaces', async (req, res) => {
  try {
    const { secret, world_id, participants } = req.body;
    if (secret !== SECRET) return res.status(403).json({ error: 'Unauthorized' });
    if (!world_id || !participants || !participants.length) {
      return res.status(400).json({ error: 'world_id and participants (array of pal IDs) are required' });
    }

    // Verify world exists
    const { data: world } = await supabase.from('worlds').select('*').eq('id', world_id).single();
    if (!world) return res.status(404).json({ error: 'World not found' });

    if (participants.length > world.max_companions) {
      return res.status(400).json({ error: `Too many companions. Max is ${world.max_companions}.` });
    }

    // Verify pals exist
    const { data: pals } = await supabase.from('pals').select('id, mind_email').in('id', participants);
    if (!pals || pals.length !== participants.length) {
      return res.status(400).json({ error: 'One or more pal IDs are invalid.' });
    }

    // Create the space
    const alias = `space-${world_id}-${Date.now()}`;
    const { data: space, error } = await supabase
      .from('spaces')
      .insert({
        world_id,
        participants,
        conversation_alias: alias,
        status: 'active',
      })
      .select('*')
      .single();

    if (error) throw new Error(error.message);

    // Initialize a Minds conversation using the first pal
    const firstPal = pals[0];
    const firstMindId = firstPal.mind_email.split('@')[0];
    await ensureConversation(alias, firstMindId);

    // Send the world's initial prompt
    const initialMessage = `${world.initial_prompt}\n\n[You are now in a shared space with ${participants.length} companions. Speak when it feels natural.]`;
    await sendMessage(alias, firstMindId, initialMessage);

    // Store the system message
    await supabase.from('space_messages').insert({
      space_id: space.id,
      sender_pal_id: null,
      content: initialMessage,
    });

    res.json({ success: true, space });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/spaces — list all active Spaces
router.get('/spaces', async (req, res) => {
  try {
    const { data: spaces, error } = await supabase
      .from('spaces')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw new Error(error.message);
    res.json({ spaces });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;