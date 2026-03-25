require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const { rag } = require('./rag');
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const { softAuth, verifyToken, requireAdmin } = require('./middleware/auth');

console.log("🚀🚀🚀 SERVER.JS IS EXECUTING! 🚀🚀🚀");

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('✅ Connected to MongoDB'))
    .catch(err => console.error('❌ MongoDB connection error:', err.message));

// --- Routes ---
app.get('/', (req, res) => res.json({ message: "Welcome to the Quokka RAG Backend!" }));

// Auth routes (public)
app.use('/api/auth', authRoutes);

// Admin routes (protected: must be logged in + admin role)
app.use('/api/admin', verifyToken, requireAdmin, adminRoutes);

// Chat routes — softAuth attaches user if token present, guests still allowed
app.post('/api/query', softAuth, async (req, res) => {
    try {
        const result = await rag.query(req.body.query, req.user);
        res.json({
            answer: result.answer || "No answer generated.",
            sources: result.sources || []
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/chat_stream', softAuth, async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    try {
        const stream = rag.queryStream(req.body.query, req.body.history || [], req.user);
        for await (const chunk of stream) {
            res.write(chunk);
        }
    } catch (e) {
        console.error("Stream error:", e);
        res.write(`data: ${JSON.stringify({ type: 'chunk', content: `\n\n*(Error: ${e.message})*` })}\n\n`);
        res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
    } finally {
        res.end();
    }
});

app.post('/api/generate_title', softAuth, async (req, res) => {
    try {
        const title = await rag.generateTitle(req.body.query, req.body.response);
        res.json({ title });
    } catch (e) {
        res.json({ title: "New Chat" });
    }
});

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => console.log(`Server is running on port ${PORT}`));
