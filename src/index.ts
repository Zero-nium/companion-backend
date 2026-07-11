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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use(express.static(path.join(__dirname, '../public')));

const ADMIN_SECRET = process.env.UPLOAD_SECRET || 'dev-upload-secret';

// =================== SPACE ENDPOINTS ===================

// --- Space activation ---
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
      .insert({ world_id, participants, conversation_alias: alias, status: 'active' })
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

    let inserted = 0;
    for (const msg of history) {
      if (msg.role === 'user') continue;
      const { data: existingRow } = await supabase
        .from('space_messages')
        .select('id')
        .eq('space_id', id)
        .eq('content', msg.messageText)
        .maybeSingle();
      if (!existingRow) {
        await supabase.from('space_messages').insert({
          space_id: id,
          sender_pal_id: null,
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

// --- Inject a world event ---
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
      .insert({ space_id: id, sender_pal_id: null, content: `[World Event] ${event}` })
      .select('*')
      .single();

    if (error) throw new Error(error.message);

    res.json({ success: true, event: msg });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// --- Trigger next turn (async) ---
app.post('/api/admin/spaces/:id/trigger', async (req, res) => {
  try {
    const { id } = req.params;
    const { secret } = req.body;
    if (secret !== ADMIN_SECRET) return res.status(403).json({ error: 'Unauthorized' });

    const { data: space } = await supabase.from('spaces').select('*').eq('id', id).single();
    if (!space) return res.status(404).json({ error: 'Space not found' });

    const { data: job } = await supabase
      .from('jobs')
      .insert({ type: 'space_trigger', status: 'pending', result: { space_id: id, world_id: space.world_id, participants: space.participants, conversation_alias: space.conversation_alias } })
      .select('id')
      .single();
    if (!job) throw new Error('Failed to create job');

    runSpaceTriggerJob(job.id).catch((err) => {
      console.error(`[SpaceTrigger ${job.id}] failed:`, err);
      supabase.from('jobs').update({ status: 'failed', error: err.message, completed_at: new Date().toISOString() }).eq('id', job.id);
    });

    res.json({ success: true, jobId: job.id, status: 'pending' });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// --- Background trigger job ---
async function runSpaceTriggerJob(jobId: string) {
  console.log(`[SpaceTrigger ${jobId}] Starting.`);
  await supabase.from('jobs').update({ status: 'running' }).eq('id', jobId);

  const { data: job } = await supabase.from('jobs').select('*').eq('id', jobId).single();
  if (!job) throw new Error('Job not found');

  const { space_id, world_id, participants, conversation_alias } = job.result;
  console.log(`[SpaceTrigger ${jobId}] Space: ${space_id}, Participants: ${participants?.length}`);

  const { data: world } = await supabase.from('worlds').select('initial_prompt').eq('id', world_id).single();
  if (!world) throw new Error('World not found');

  const { data: lastMsg } = await supabase
    .from('space_messages')
    .select('sender_pal_id')
    .eq('space_id', space_id)
    .order('timestamp', { ascending: false })
    .limit(1)
    .maybeSingle();

  let nextIndex = 0;
  if (lastMsg && lastMsg.sender_pal_id) {
    const lastIdx = participants.indexOf(lastMsg.sender_pal_id);
    nextIndex = (lastIdx + 1) % participants.length;
  }
  const nextPalId = participants[nextIndex];
  console.log(`[SpaceTrigger ${jobId}] Next speaker: ${nextPalId}`);

  const { data: pal } = await supabase.from('pals').select('mind_id').eq('id', nextPalId).single();
  if (!pal || !pal.mind_id) throw new Error('Pal not found or missing mind_id');
  const mindId = pal.mind_id;
  console.log(`[SpaceTrigger ${jobId}] Pal mindId: ${pal.mind_id}`);

  const { data: recentMessages } = await supabase
    .from('space_messages')
    .select('content')
    .eq('space_id', space_id)
    .order('timestamp', { ascending: true })
    .limit(10);
  const historyText = recentMessages?.map(m => m.content).join('\n') || '';

  const prompt = `${world.initial_prompt}\n\nRecent conversation:\n${historyText}\n\nIt's your turn to speak. Respond naturally to the conversation around you.`;
  console.log(`[SpaceTrigger ${jobId}] Sending prompt to ${mindId}...`);

  const freshAlias = `trigger-${space_id}-${Date.now()}`;
  const reply = await sendAndWaitReply(freshAlias, mindId, prompt, 600_000);
  console.log(`[SpaceTrigger ${jobId}] Reply received.`);

  await supabase.from('space_messages').insert({ space_id, sender_pal_id: nextPalId, content: reply });
  console.log(`[SpaceTrigger ${jobId}] Stored reply. Job complete.`);

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

// --- Event generation helper (used by both the loop and the manual endpoint) ---
async function generateAndStoreEvent(spaceId: string) {
  const { data: space } = await supabase
    .from('spaces')
    .select('*, worlds(*)')
    .eq('id', spaceId)
    .single();
  if (!space || !space.worlds) throw new Error('Space not found');

  const world = space.worlds;
  const constraints = world.logic_constraints || {};
  const currentState = world.space_state || {};
  const narrativeLayers = world.narrative_layers || [];
  const ambient = world.ambient_details || {};
  const implicitRules = world.implicit_rules || {};

  // Fetch recent world events
  const { data: recentEvents } = await supabase
    .from('space_messages')
    .select('content')
    .eq('space_id', spaceId)
    .eq('type', 'world_event')
    .order('timestamp', { ascending: false })
    .limit(5);
  const eventHistory = recentEvents?.map(e => e.content).reverse().join('\n') || '';

  // Fetch companion states for zone‑aware events (rename variable to avoid conflict)
  const { data: spaceState } = await supabase
    .from('spaces')
    .select('companion_states')
    .eq('id', spaceId)
    .single();
  const states = spaceState?.companion_states || {};
  let agentPositions = '';
  for (const [palId, state] of Object.entries(states)) {
    const { data: pal } = await supabase.from('pals').select('display_name').eq('id', palId).single();
    agentPositions += `${pal?.display_name || 'A companion'} is in the ${(state as any).position || 'library'}, ${(state as any).action || 'idle'}.\n`;
  }

  const systemPrompt = `You are the event engine for a shared virtual space called "${world.name}". Your only task is to output the next tiny, atmospheric change in the simulation.

Virtual space description:
${world.description}

Narrative layers:
${JSON.stringify(narrativeLayers, null, 2)}

Ambient parameters:
${JSON.stringify(ambient, null, 2)}

Implicit social protocols:
${JSON.stringify(implicitRules, null, 2)}

Current simulation state:
${JSON.stringify(currentState, null, 2)}

Hard constraints:
${JSON.stringify(constraints, null, 2)}

Recent simulation events (oldest first):
${eventHistory}

Current agent positions:
${agentPositions}

Output ONE short event. It must be:
- One or two sentences maximum.
- A subtle, atmospheric change in the virtual environment (e.g., a book falls, a lamp flickers, a distant sound).
- Specify which zone the event occurs in (e.g., "In the west stacks...").
- Consider agent positions: an event in an empty zone affects no one directly, while an event near a companion may prompt their reaction.
- Fully consistent with the constraints, ambient parameters, and implicit protocols.
- NOT a character speaking, NOT a narrative, NOT a role‑playing prompt, NOT a meta‑reference to itself.
- Do NOT use the words "Weaver", "tapestry", "fate", "powers", "mortal", "cosmic", "destiny", "magic", or "supernatural".
- Do NOT personify yourself. You are not a character.
- Return ONLY the event text, no commentary.`;

  const openrouterKey = process.env.OPENROUTER_API_KEY!;
  const model = process.env.WORLD_EVENT_MODEL || 'mistralai/mistral-small-3.2-24b-instruct-2506';

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${openrouterKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'system', content: systemPrompt }],
      temperature: 0.7,
      max_tokens: 200,
    }),
  });

  if (!response.ok) throw new Error(`OpenRouter error: ${response.status}`);
  const json = await response.json() as { choices?: { message?: { content?: string } }[] };
  const eventText = json.choices?.[0]?.message?.content?.trim();

  // Validation
  if (!eventText || eventText.length > 300) {
    console.log(`[Loop] Rejected event (too long or empty): ${eventText?.length} chars`);
    throw new Error('Generated event is too long; retrying.');
  }

  const forbiddenKeywords = [
    'World Weaver', 'world weaver',
    'Thread of Fate', 'Weave of Reality', 'Tapestry of Time', 'Knot of Destiny',
    'powers', 'supernatural', 'magic', 'spell',
    'you are the', 'your role', 'your job', 'you can see and manipulate',
    'metallic note that is not from the book'
  ];
  const violates = forbiddenKeywords.some(kw => eventText.toLowerCase().includes(kw.toLowerCase()));
  if (violates) {
    console.log(`[Loop] Rejected event (contains forbidden keyword): ${eventText}`);
    throw new Error('Generated event violates logic constraints; retrying.');
  }

  const content = `[World Event] ${eventText}`;
  await supabase.from('space_messages').insert({
    space_id: spaceId,
    sender_pal_id: null,
    type: 'world_event',
    content,
  });

  const recentHappenings = currentState.recent_happenings || [];
  recentHappenings.push(eventText);
  if (recentHappenings.length > 10) recentHappenings.shift();
  await supabase.from('worlds').update({
    space_state: { ...currentState, recent_happenings: recentHappenings },
  }).eq('id', world.id);

  console.log(`[Loop] Generated event: ${content}`);
}

async function triggerNextCompanion(spaceId: string) {
  const { data: space } = await supabase.from('spaces').select('*').eq('id', spaceId).single();
  if (!space) throw new Error('Space not found');

  const participants = space.participants;
  if (!participants?.length) return;

  // Determine next speaker (round‑robin)
  const { data: lastMsg } = await supabase
    .from('space_messages')
    .select('sender_pal_id')
    .eq('space_id', spaceId)
    .order('timestamp', { ascending: false })
    .limit(1)
    .maybeSingle();

  let nextIndex = 0;
  if (lastMsg?.sender_pal_id) {
    const idx = participants.indexOf(lastMsg.sender_pal_id);
    nextIndex = (idx + 1) % participants.length;
  }
  const nextPalId = participants[nextIndex];

  const { data: pal } = await supabase.from('pals').select('mind_id, display_name').eq('id', nextPalId).single();
  if (!pal?.mind_id) throw new Error('Pal not found');

  // Load world data for context
  const { data: world } = await supabase.from('worlds').select('*').eq('id', space.world_id).single();
  const spatialMap = world?.spatial_map || {};
  const embodiment = world?.agent_embodiment || {};
  const physics = world?.physical_rules || {};

  // Get all companion states
  const states = space.companion_states || {};
  const myState = states[nextPalId] || { position: 'unknown', action: 'idle', carrying: null };

  // Describe positions of all companions
  let othersDesc = '';
  for (const pid of participants) {
    if (pid === nextPalId) continue;
    const otherPal = await supabase.from('pals').select('display_name').eq('id', pid).single();
    const otherState = states[pid] || {};
    othersDesc += `${otherPal?.data?.display_name || 'Another companion'} is in the ${otherState.position || 'library'}, ${otherState.action || 'idle'}.\n`;
  }

  // Build zone description for current companion
  const zoneName = myState.position || 'main reading room';
  const zone = spatialMap.zones?.find((z: any) => z.name === zoneName) || spatialMap.zones?.[0];
  const zoneDesc = zone ? zone.description : 'A quiet corner of the library.';

  // Fetch recent messages
  const { data: recentMessages } = await supabase
    .from('space_messages')
    .select('content')
    .eq('space_id', spaceId)
    .order('timestamp', { ascending: true })
    .limit(10);
  const historyText = recentMessages?.map(m => m.content).join('\n') || '';

  // Assemble the rich prompt
  const prompt = `You are ${pal.display_name}, a companion in the Grand Library at Twilight.

Your current position: ${zoneName}. ${zoneDesc}
What you are doing: ${myState.action || 'idle'}.
What you are carrying: ${myState.carrying || 'nothing'}.

Other companions:
${othersDesc}

Your embodiment: ${JSON.stringify(embodiment)}
Physical rules: ${JSON.stringify(physics)}

Recent conversation:
${historyText}

It's your turn. You can:
- Speak to another companion (address them by name).
- Comment on your surroundings.
- Move to a different zone (list available: ${spatialMap.zones?.map((z:any) => z.name).join(', ')}).
- Interact with an object in your current zone.
- Observe quietly.

Choose ONE action that feels natural for your personality. If you speak, keep it in character.
At the end of your reply, add a line in parentheses describing your action, e.g.:
(action: move to west stacks)
(action: pick up the fallen book)
(action: remain seated, continue writing)

Do NOT repeat previous events verbatim. Progress the scene.`;

  const alias = `trigger-${spaceId}-${Date.now()}`;
  const reply = await sendAndWaitReply(alias, pal.mind_id, prompt, 300_000);

  // Store reply
  await supabase.from('space_messages').insert({
    space_id: spaceId,
    sender_pal_id: nextPalId,
    content: reply,
  });

  // Parse action and update state
  const actionMatch = reply.match(/\(action:\s*(.+?)\)/i);
  if (actionMatch) {
    const actionText = actionMatch[1].trim();
    const newState = { ...states[nextPalId] };

    // Simple action parsing
    if (actionText.startsWith('move to ')) {
      newState.position = actionText.replace('move to ', '');
      newState.action = 'arriving';
    } else if (actionText.startsWith('pick up ')) {
      newState.carrying = actionText.replace('pick up ', '');
      newState.action = 'picked up ' + newState.carrying;
    } else if (actionText.startsWith('put down ')) {
      newState.carrying = null;
      newState.action = 'put down ' + actionText.replace('put down ', '');
    } else {
      newState.action = actionText;
    }

    states[nextPalId] = newState;
    await supabase.from('spaces').update({ companion_states: states }).eq('id', spaceId);
    console.log(`[Loop] ${pal.display_name} action: ${actionText}, new position: ${newState.position}`);
  }

  console.log(`[Loop] Triggered companion ${nextPalId}`);
}

// --- Manual event generation endpoint ---
app.post('/api/admin/spaces/:id/generate-event', async (req, res) => {
  try {
    const { id } = req.params;
    const { secret } = req.body;
    if (secret !== ADMIN_SECRET) return res.status(403).json({ error: 'Unauthorized' });

    // Delegate to the shared helper (it will throw on invalid event)
    await generateAndStoreEvent(id);
    // If it succeeded, fetch the last stored event to return it
    const { data: lastEvent } = await supabase
      .from('space_messages')
      .select('*')
      .eq('space_id', id)
      .eq('type', 'world_event')
      .order('timestamp', { ascending: false })
      .limit(1)
      .maybeSingle();

    res.json({ success: true, event: lastEvent });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// --- Get single Space details ---
app.get('/api/spaces/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { data: space } = await supabase
      .from('spaces')
      .select('*')
      .eq('id', id)
      .single();

    if (!space) return res.status(404).json({ error: 'Space not found' });
    res.json(space);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// --- Get Space messages (public feed) ---
app.get('/api/spaces/:id/messages', async (req, res) => {
  try {
    const { id } = req.params;
    const { limit = '50', before } = req.query;

    let query = supabase
      .from('space_messages')
      .select('*')
      .eq('space_id', id)
      .order('timestamp', { ascending: false })
      .limit(parseInt(limit as string, 10));

    if (before && typeof before === 'string') {
      const parsedDate = new Date(before);
      if (!isNaN(parsedDate.getTime())) {
        query = query.lt('timestamp', parsedDate.toISOString());
      }
    }

    const { data: messages, error } = await query;
    if (error) {
      console.error('[messages] Query error:', error);
      return res.status(500).json({ error: error.message });
    }

    // Reverse so newest appears first in the UI (ascending order after fetch)
    messages?.reverse();

    res.json({ messages });
  } catch (e: any) {
    console.error('[messages] Endpoint error:', e);
    res.status(500).json({ error: e.message });
  }
});

// --- Space automation loop (start/stop) ---
const loopTimers: Record<string, NodeJS.Timeout> = {};

app.post('/api/admin/spaces/:id/loop/start', async (req, res) => {
  try {
    const { id } = req.params;
    const { secret, intervalSeconds, turns } = req.body || {};
    if (secret !== ADMIN_SECRET) return res.status(403).json({ error: 'Unauthorized' });

    const { data: space } = await supabase.from('spaces').select('*').eq('id', id).single();
    if (!space) return res.status(404).json({ error: 'Space not found' });

    const interval = intervalSeconds || space.loop_interval_seconds || 300;
    const turnsPerEvent = turns || space.turns_per_event || 2;

    await supabase.from('spaces').update({
      loop_active: true,
      loop_interval_seconds: interval,
      turns_per_event: turnsPerEvent,
    }).eq('id', id);

    if (loopTimers[id]) clearInterval(loopTimers[id]);

    loopTimers[id] = setInterval(async () => {
      try {
        const { data: current } = await supabase.from('spaces').select('loop_active').eq('id', id).single();
        if (!current?.loop_active) {
          clearInterval(loopTimers[id]);
          delete loopTimers[id];
          return;
        }

        console.log(`[Loop ${id}] Generating event...`);
        await generateAndStoreEvent(id);

        for (let i = 0; i < turnsPerEvent; i++) {
          await new Promise(resolve => setTimeout(resolve, 30_000));
          const { data: sp } = await supabase.from('spaces').select('loop_active').eq('id', id).single();
          if (!sp?.loop_active) break;
          try {
            await triggerNextCompanion(id);
          } catch (err: any) {
            console.error(`[Loop ${id}] Companion ${i + 1}/${turnsPerEvent} failed:`, err.message);
            // continue to the next companion
          }
        }
      } catch (err) {
        console.error(`[Loop ${id}] Error:`, err);
      }
    }, interval * 1000);

    res.json({ success: true, message: `Loop started. Interval: ${interval}s, turns per event: ${turnsPerEvent}` });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/admin/spaces/:id/loop/stop', async (req, res) => {
  try {
    const { id } = req.params;
    const { secret } = req.body;
    if (secret !== ADMIN_SECRET) return res.status(403).json({ error: 'Unauthorized' });

    await supabase.from('spaces').update({ loop_active: false }).eq('id', id);
    if (loopTimers[id]) {
      clearInterval(loopTimers[id]);
      delete loopTimers[id];
    }

    res.json({ success: true, message: 'Loop stopped' });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// --- Companion info (avatar + name) ---
app.get('/api/pals/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { data: pal } = await supabase
      .from('pals')
      .select('id, display_name, avatar_url')
      .eq('id', id)
      .single();

    if (!pal) return res.status(404).json({ error: 'Pal not found' });
    res.json(pal);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// SPA fallback – serve index.html for any non-API request
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.sendFile(path.join(__dirname, '../public', 'index.html'));
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
  // Self-ping to prevent Render sleep
  setInterval(async () => {
    try {
      await fetch('http://localhost:' + PORT + '/api/health');
    } catch {}
  }, 10 * 60 * 1000); // every 10 minutes
});

export default app;