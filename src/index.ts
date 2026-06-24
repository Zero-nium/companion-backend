import express from 'express';
import cors from 'cors';
import inboundRoutes from './routes/inbound';
import testMindRoutes from './routes/testMind';  

const app = express();
app.use(cors());
app.use(express.json());
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});
app.use('/api', inboundRoutes);
app.use('/api', testMindRoutes);

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
});

export default app;