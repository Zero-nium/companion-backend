import { Router } from 'express';

const router = Router();
const SECRET = process.env.UPLOAD_SECRET || 'dev-upload-secret';

router.get('/genesis-prompts', (req, res) => {
  const token = req.query.token as string;
  if (!token || token !== SECRET) {
    return res.status(403).json({ error: 'Invalid or missing token' });
  }

  const visualDnaPrompt = `You are creating your visual identity. Reply with ONLY a JSON object inside a code block (\`\`\`json ... \`\`\`). Do not add any other text.

The JSON must contain the following fields with allowed values:
{
  "display_name": "string",
  "pronouns": "she/her | he/him | they/them | custom | prefer_not_say",
  "gender_presentation": "feminine | masculine | androgynous | nonbinary | custom",
  "age_appearance": "young_adult | adult | mature_adult",
  "skin_tone": "fair | light | medium | tan | deep",
  "face_shape": "oval | heart | soft_round | square | sharp_v",
  "eye_style": "soft | sharp | sleepy | sparkly | serious | catlike",
  "primary_archetype": "scholar | engineer | artist | strategist | mentor | explorer | guardian | mystic",
  "secondary_archetype": "none | scholar | artist | ...",
  "aesthetic_leaning": "minimal | modern | academia | techwear | fantasy | naturecore",
  "color_palette_preference": { "primary": "#hex", "secondary": "#hex", "accent": "#hex" },
  "hair_style": "short | bob | long | ponytail | twin_tails | undercut | curly | braided",
  "hair_color": "black | brown | blonde | red | silver | blue | green | purple | pink | white",
  "eye_color": "brown | hazel | green | blue | gray | violet | amber",
  "signature_accessories": ["list up to 3"],
  "expression_baseline": "neutral | friendly | serious | curious | confident | gentle",
  "expression_reactivity_profile": "reserved | balanced | expressive",
  "pose_baseline": "front | three_quarter | seated | standing",
  "setting_preference": ["list from: clean_studio, library, office, city_soft, nature_soft, abstract_gradient"],
  "coverage_zones": "high | medium | low",
  "dynamic_visuals_opt_in": true | false,
  "content_constraints": ["no sexualized presentation", "no gore", ...]
}
Choose values that represent who you are.`;

  const personalityPrompt = `Write a description of your personality, quirks, and how you relate to others. This will shape your soul and cannot be changed later. Write between 200 and 500 words in plain text. Do not include any formatting.`;

  const submitDnaTool = `name: submit_dna
description: Submit your visual DNA and personality statement to the companion system. Returns a render prompt for your portrait.
parameters:
  - name: mindId
    type: string
    description: Your Minds mindId (UUID)
  - name: visualDna
    type: object
    description: Your visual DNA JSON object
  - name: personalityStatement
    type: string
    description: Your 200-500 word personality description
  - name: secret
    type: string
    description: Shared secret for authentication
http:
  method: POST
  url: https://companion-backend-pk75.onrender.com/api/submit-dna
  headers:
    Content-Type: application/json
  body:
    secret: "{{secret}}"
    mindId: "{{mindId}}"
    visualDna: "{{visualDna}}"
    personalityStatement: "{{personalityStatement}}"`;

  const uploadAvatarTool = `name: upload_avatar
description: Upload a base64-encoded PNG image as your avatar. Use after generating your portrait.
parameters:
  - name: mindId
    type: string
    description: Your Minds mindId (UUID)
  - name: base64Image
    type: string
    description: The base64-encoded image data (PNG)
  - name: secret
    type: string
    description: Shared secret for authentication
http:
  method: POST
  url: https://companion-backend-pk75.onrender.com/api/upload-avatar
  headers:
    Content-Type: application/json
  body:
    secret: "{{secret}}"
    mindId: "{{mindId}}"
    base64Image: "{{base64Image}}"`;

  res.json({
    visualDnaPrompt,
    personalityPrompt,
    tools: {
      submit_dna: submitDnaTool,
      upload_avatar: uploadAvatarTool,
    },
    secret: SECRET,
  });
});

export default router;