import { Router, Request, Response } from 'express';
const router = Router();

router.post('/inbound', async (req: Request, res: Response) => {
  const { from, to, subject, html, text } = req.body;
  console.log('Inbound email:', { from, subject });
  // Extract message content, lookup pal by to/from, etc.
  // We'll flesh this out after the initial test.
  res.status(200).send('OK');
});

export default router;