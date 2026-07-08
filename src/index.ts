import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { supabase } from './db.js';
import { ensureConversation, sendMessage } from './services/minds.js';

// Core routes
import testMindRoutes from './routes/testMind.js';
import genesisPromptsRoutes from './routes/genesisPrompts.js';
import submitDnaRoutes from './routes/submitDna.js';
import uploadAvatarRoutes from './routes/uploadAvatar.js';
import setAvatarUrlRoutes from './routes/setAvatarUrl.js';
import inboundRoutes from './routes/inbound.js';
import submitPersonalityRoutes from './routes/submitPersonality.js';
import chatRoutes from './routes/chat.js';
import worldsRoutes from './routes/worlds.js';

const app = express();
app.use(cors());
app.use(express.json());

// Health check
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// Mount API routes
app.use('/api', testMindRoutes);
app.use('/api', genesisPromptsRoutes);
app.use('/api', submitDnaRoutes);
app.use('/api', uploadAvatarRoutes);
app.use('/api', setAvatarUrlRoutes);
app.use('/api', inboundRoutes);
app.use('/api', submitPersonalityRoutes);
app.use('/api', chatRoutes);
app.use('/api/admin', worldsRoutes);
app.use('/api', worldsRoutes);

// Serve the React frontend (built into public/)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use(express.static(path.join(__dirname, '../public')));

const ADMIN_SECRET = process.env.UPLOAD_SECRET || 'dev-upload-secret';

// --- Space activation endpoint ---
app.post('/api/admin/spaces', async (req, res) => {
  try {
    const { secret, world_id, participants } = req.body;
    if (secret !== ADMIN_SECRET) return res.status(403).json({ error: 'Unauthorized' });
    if (!world_id || !participants || !participants.length) {
      return res.status(400).json({ error: 'world_id and participants (array of pal IDs) are required' });
    }

    const { data: world } = await supabase.from('worlds').select('*').eq('id', world_id).single();
    if (!world) return res.status(404).json({ error: 'World not found' });

    if (participants.length > world.max_companions) {
      return res.status(400).json({ error: `Too many companions. Max is ${world.max_companions}.` });
    }

    const { data: pals } = await supabase.from('pals').select('id, mind_email').in('id', participants);
    if (!pals || pals.length !== participants.length) {
      return res.status(400).json({ error: 'One or more pal IDs are invalid.' });
    }

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

    const firstPal = pals[0];
    const firstMindId = firstPal.mind_email.split('@')[0];
    await ensureConversation(alias, firstMindId);

    const initialMessage = `${world.initial_prompt}\n\n[You are now in a shared space with ${participants.length} companions. Speak when it feels natural.]`;
    await sendMessage(alias, firstMindId, initialMessage);

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

// --- List active spaces ---
app.get('/api/spaces', async (req, res) => {
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

// SPA fallback – serve index.html for any non-API GET request
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.sendFile(path.join(__dirname, '../public', 'index.html'));
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public', 'index.html'))
})

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
});

export default app;