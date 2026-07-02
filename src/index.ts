import express from 'express';
import cors from 'cors';
import inboundRoutes from './routes/inbound.js';
// import adminRoutes from './routes/admin.js'; // to be added later
import testMindRoutes from './routes/testMind.js';
import genesisRoutes from './routes/genesis.js';
import testImageRoutes from './routes/testImage.js';
import checkImageRoutes from './routes/checkImage.js';
import testImageAsyncRoutes from './routes/testImageAsync.js';
import renderRoutes from './routes/render.js';
import testRenderImageRoutes from './routes/testRenderImage.js';
import renderDirectRoutes from './routes/renderDirect.js';
import fetchArtifactRoutes from './routes/fetchArtifact.js';

const app = express();
app.use(cors());
app.use(express.json());
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});
app.use('/api', inboundRoutes);
app.use('/api', testMindRoutes);
// app.use('/api', adminRoutes); // to be added later
app.use('/api/admin', genesisRoutes);
app.use('/api', testImageRoutes);
app.use('/api', checkImageRoutes);
app.use('/api/admin', testImageAsyncRoutes);
app.use('/api/admin', renderRoutes);
app.use('/api', testRenderImageRoutes);
app.use('/api', renderDirectRoutes);
app.use('/api/admin', fetchArtifactRoutes);

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
});

export default app;