import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT || 8888;

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'web')));

app.get('/api/status', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Remote Claude host server listening on port ${PORT}`);
});
