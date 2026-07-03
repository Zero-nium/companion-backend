import express from 'express';
import cors from 'cors';

// Core routes (keep)
import testMindRoutes from './routes/testMind.js';
import genesisPromptsRoutes from './routes/genesisPrompts.js';
import submitDnaRoutes from './routes/submitDna.js';
import uploadAvatarRoutes from './routes/uploadAvatar.js';
import setAvatarUrlRoutes from './routes/setAvatarUrl.js';
import inboundRoutes from './routes/inbound.js'; // harmless placeholder

const app = express();
app.use(cors());
app.use(express.json());

// Health check
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// Mount routes
app.use('/api', testMindRoutes);
app.use('/api', genesisPromptsRoutes);
app.use('/api', submitDnaRoutes);
app.use('/api', uploadAvatarRoutes);
app.use('/api', setAvatarUrlRoutes);
app.use('/api', inboundRoutes); // keep for future email webhook

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
});

export default app;