import express from 'express';
import cors from 'cors';
import inboundRoutes from './routes/inbound.js';
// import adminRoutes from './routes/admin.js'; // to be added later
import testMindRoutes from './routes/testMind.js';
import genesisRoutes from './routes/genesis.js';

const app = express();
app.use(cors());
app.use(express.json());
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});
app.use('/api', inboundRoutes);
app.use('/api', testMindRoutes);
// app.use('/api', adminRoutes); // to be added later
app.use('/api', genesisRoutes);

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
});

export default app;