import { Router } from 'express';
import { supabase } from '../db.js';

const router = Router();
const SECRET = process.env.UPLOAD_SECRET || 'dev-upload-secret';

// -----------------------------------------------------------------
// POST /api/admin/worlds — create a new World Seed
// -----------------------------------------------------------------
router.post('/worlds', async (req, res) => {
  try {
    const { secret, name, theme, description, max_companions, seed_rules, initial_prompt } = req.body;
    if (secret !== SECRET) return res.status(403).json({ error: 'Unauthorized' });

    if (!name || !initial_prompt) {
      return res.status(400).json({ error: 'name and initial_prompt are required' });
    }

    const { data: world, error } = await supabase
      .from('worlds')
      .insert({
        name,
        theme: theme || null,
        description: description || null,
        max_companions: max_companions || 8,
        seed_rules: seed_rules || null,
        initial_prompt,
      })
      .select('*')
      .single();

    if (error) throw new Error(error.message);

    res.json({ success: true, world });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// -----------------------------------------------------------------
// GET /api/worlds — list all World Seeds
// -----------------------------------------------------------------
router.get('/worlds', async (req, res) => {
  try {
    const { data: worlds, error } = await supabase
      .from('worlds')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw new Error(error.message);

    res.json({ worlds });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;