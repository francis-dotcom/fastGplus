import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import routes from './routes/index.js';

const app = express();

app.use(cors({ origin: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/api', routes);

app.get('/', (_req, res) => {
  res.json({ message: 'Grand Plus College API', docs: '/api/health' });
});

app.listen(config.port, () => {
  console.log(`Server running at http://localhost:${config.port} (${config.nodeEnv})`);
});
