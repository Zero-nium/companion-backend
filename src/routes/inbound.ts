import { Router, Request, Response } from 'express';

const router = Router();

router.post('/inbound', async (req: Request, res: Response) => {
  // The inbound webhook from Resend is not currently used for agent communication.
  // Agent messaging now goes through the Minds client library.
  // We'll re-implement Genesis reply handling using Minds conversations later.
  console.log('Inbound webhook received (not processed):', req.body);
  res.status(200).send('OK');
});

export default router;