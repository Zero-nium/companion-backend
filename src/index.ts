import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { supabase } from './db.js';
import { ensureConversation, sendMessage, getHistory, sendAndWaitReply } from './services/minds.js';

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

// --- Collect Space messages ---
app.post('/api/admin/spaces/:id/collect', async (req, res) => {
  try {
    const { id } = req.params;
    const { secret } = req.body;
    if (secret !== ADMIN_SECRET) return res.status(403).json({ error: 'Unauthorized' });

    const { data: space } = await supabase.from('spaces').select('*').eq('id', id).single();
    if (!space) return res.status(404).json({ error: 'Space not found' });

    const alias = space.conversation_alias;
    const history = await getHistory(alias, undefined, 10);
    if (!history || history.length === 0) return res.json({ collected: 0, message: 'No messages found' });
    
    console.log(`[collect] Alias: ${alias}, messages: ${history.length}`);
    history.forEach((m: any, i: number) => {
      console.log(`[collect]   [${i}] role=${m.role}, text=${m.messageText?.substring(0, 50)}`);
    });
    
    // Insert any new messages (avoid duplicates by checking messageId)
    let inserted = 0;
    for (const msg of history) {
      if (msg.role === 'user') continue; // skip system/user messages
      const { data: existingRow } = await supabase
        .from('space_messages')
        .select('id')
        .eq('space_id', id)
        .eq('content', msg.messageText)
        .maybeSingle();
      if (!existingRow) {
        await supabase.from('space_messages').insert({
          space_id: id,
          sender_pal_id: null, // we could map sender email to pal ID later
          content: msg.messageText,
          timestamp: msg.createdAt || new Date().toISOString(),
        });
        inserted++;
      }
    }

    res.json({ collected: inserted, message: `Collected ${inserted} new messages` });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// --- Inject a world event into a Space ---
app.post('/api/admin/spaces/:id/event', async (req, res) => {
  try {
    const { id } = req.params;
    const { secret, event } = req.body;
    if (secret !== ADMIN_SECRET) return res.status(403).json({ error: 'Unauthorized' });

    if (!event) return res.status(400).json({ error: 'event description is required' });

    const { data: space } = await supabase.from('spaces').select('id').eq('id', id).single();
    if (!space) return res.status(404).json({ error: 'Space not found' });

    const { data: msg, error } = await supabase
      .from('space_messages')
      .insert({
        space_id: id,
        sender_pal_id: null,
        content: `[World Event] ${event}`,
      })
      .select('*')
      .single();

    if (error) throw new Error(error.message);

    res.json({ success: true, event: msg });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// --- Trigger next turn in a Space ---
app.post('/api/admin/spaces/:id/trigger', async (req, res) => {
  try {
    const { id } = req.params;
    const { secret } = req.body;
    if (secret !== ADMIN_SECRET) return res.status(403).json({ error: 'Unauthorized' });

    const { data: space } = await supabase.from('spaces').select('*').eq('id', id).single();
    if (!space) return res.status(404).json({ error: 'Space not found' });

    // Create a background job
    const { data: job } = await supabase
      .from('jobs')
      .insert({ type: 'space_trigger', status: 'pending', result: { space_id: id, world_id: space.world_id, participants: space.participants, conversation_alias: space.conversation_alias } })
      .select('id')
      .single();
    if (!job) throw new Error('Failed to create job');

    // Run in background (don't await)
    runSpaceTriggerJob(job.id).catch((err) => {
      console.error(`[SpaceTrigger ${job.id}] failed:`, err);
      supabase.from('jobs').update({ status: 'failed', error: err.message, completed_at: new Date().toISOString() }).eq('id', job.id);
    });

    res.json({ success: true, jobId: job.id, status: 'pending' });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

async function runSpaceTriggerJob(jobId: string) {
  await supabase.from('jobs').update({ status: 'running' }).eq('id', jobId);

  const { data: job } = await supabase.from('jobs').select('*').eq('id', jobId).single();
  if (!job) throw new Error('Job not found');

  const { space_id, world_id, participants, conversation_alias } = job.result;
  const alias = conversation_alias;

  // 1. Load world
  const { data: world } = await supabase.from('worlds').select('initial_prompt').eq('id', world_id).single();
  if (!world) throw new Error('World not found');

  // 2. Determine next speaker
  const { data: lastMsg } = await supabase.from('space_messages').select('sender_pal_id').eq('space_id', space_id).order('timestamp', { ascending: false }).limit(1).maybeSingle();
  let nextIndex = 0;
  if (lastMsg && lastMsg.sender_pal_id) {
    const lastIdx = participants.indexOf(lastMsg.sender_pal_id);
    nextIndex = (lastIdx + 1) % participants.length;
  }
  const nextPalId = participants[nextIndex];

  // 3. Load pal email
  const { data: pal } = await supabase.from('pals').select('mind_email').eq('id', nextPalId).single();
  if (!pal) throw new Error('Pal not found');
  const mindId = pal.mind_email.split('@')[0];

  // 4. Fetch recent messages
  const { data: recentMessages } = await supabase.from('space_messages').select('content').eq('space_id', space_id).order('timestamp', { ascending: true }).limit(10);
  const historyText = recentMessages?.map(m => m.content).join('\n') || '';

  // 5. Build prompt
  const prompt = `${world.initial_prompt}\n\nRecent conversation:\n${historyText}\n\nIt's your turn to speak. Respond naturally to the conversation around you.`;

  // 6. Send to companion (up to 5 minutes)
  const reply = await sendAndWaitReply(alias, mindId, prompt, 300_000);

  // 7. Store reply
  await supabase.from('space_messages').insert({ space_id, sender_pal_id: nextPalId, content: reply });

  // 8. Mark job completed
  await supabase.from('jobs').update({ status: 'completed', result: { ...job.result, sender: nextPalId, reply }, completed_at: new Date().toISOString() }).eq('id', jobId);
}

// --- Generic job status ---
app.get('/api/admin/jobs/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { data: job } = await supabase.from('jobs').select('*').eq('id', id).single();
    if (!job) return res.status(404).json({ error: 'Job not found' });
    res.json({ jobId: job.id, status: job.status, result: job.result, error: job.error });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// SPA fallback – serve index.html for any non-API GET request
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.sendFile(path.join(__dirname, '../public', 'index.html'));
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
});

export default app;