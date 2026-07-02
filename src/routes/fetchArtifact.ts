import { Router } from 'express';
import { supabase } from '../db.js';
import { ensureConversation, sendMessage, getHistory } from '../services/minds.js';

const router = Router();
const ADMIN_KEY = process.env.ADMIN_KEY || 'dev-secret';

router.post('/fetch-artifact', async (req, res) => {
  try {
    const { adminKey, palId, artifactId } = req.body;
    if (adminKey !== ADMIN_KEY) return res.status(403).json({ error: 'Unauthorized' });

    const { data: pal } = await supabase.from('pals').select('mind_email').eq('id', palId).single();
    if (!pal) return res.status(404).json({ error: 'Pal not found' });

    const mindId = pal.mind_email.split('@')[0];
    const alias = `fetch-${Date.now()}`;

    // Ask Poly to attach the artifact
    await ensureConversation(alias, mindId);
    await sendMessage(alias, mindId, `Please attach the artifact with ID ${artifactId}.`);

    // Poll for the attachment up to 12 times (60 seconds total)
    for (let i = 0; i < 12; i++) {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      const history = await getHistory(alias, undefined, 10);

      const attachmentMessage = history.find((m: any) => m.artifactId === artifactId);
      if (attachmentMessage?.attachments) {
        const attachment = attachmentMessage.attachments.find((att: any) => att.artifactId === artifactId);
        if (attachment?.artifact) {
          // Upload to Supabase Storage
          const imageBuffer = Buffer.from(attachment.artifact, 'base64');
          const mimeType = attachment.mimeType || 'image/png';
          const extension = attachment.extension || 'png';
          const fileName = `${palId}/${Date.now()}.${extension}`;
          await supabase.storage.from('avatars').upload(fileName, imageBuffer, { contentType: mimeType, upsert: true });
          const { data: publicUrl } = supabase.storage.from('avatars').getPublicUrl(fileName);
          const avatarUrl = publicUrl.publicUrl;

          await supabase.from('pals').update({ avatar_url: avatarUrl }).eq('id', palId);

          console.log(`[fetch-artifact] Avatar stored: ${avatarUrl}`);
          return res.json({ success: true, avatarUrl });
        }
      }
    }

    res.status(404).json({ error: 'Artifact not found after waiting 60 seconds' });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;