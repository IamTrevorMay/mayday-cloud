require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { authMiddleware } = require('./middleware/auth');
const nasRouter = require('./routes/nas');
const sharesRouter = require('./routes/shares');
const dropRouter = require('./routes/drop');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

// Public health check
app.get('/health', (req, res) => res.json({ ok: true, service: 'mayday-cloud-api' }));

// Public routes (no auth) — share link drop endpoints
app.use('/api/drop', dropRouter);

// Protected routes — require valid Supabase JWT
app.use('/api', authMiddleware);
app.use('/api/nas', nasRouter);
app.use('/api/shares', sharesRouter);

// User info (tests that auth works)
app.get('/api/me', (req, res) => {
  res.json({ user: req.user });
});

app.listen(PORT, () => {
  console.log(`[Mayday Cloud API] listening on :${PORT}`);
});
