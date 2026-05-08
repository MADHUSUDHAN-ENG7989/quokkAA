require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const { rag } = require('./rag');
const { liveRag } = require('./live-rag');
const { hybridRag } = require('./hybrid-rag');
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const { softAuth, verifyToken, requireAdmin } = require('./middleware/auth');
const ChatSession = require('./models/ChatSession');

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
        const stream = req.body.model === 'hybrid'
            ? hybridRag.queryStream(req.body.query, req.body.history || [], req.user)
            : req.body.model === 'qdrant'
            ? liveRag.queryStream(req.body.query, req.body.history || [], req.user, req.body.model)
            : rag.queryStream(req.body.query, req.body.history || [], req.user, req.body.model);
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

// --- Chat History API Routes ---

// GET /api/chats - Fetch all chat sessions for active user or guestId
app.get('/api/chats', softAuth, async (req, res) => {
    try {
        let filter = {};
        if (req.user) {
            filter.userId = req.user.id;
        } else {
            const guestId = req.headers['x-guest-id'];
            if (!guestId) {
                return res.json([]);
            }
            filter.userId = null;
            filter.guestId = guestId;
        }
        const sessions = await ChatSession.find(filter).sort({ updatedAt: -1 });
        res.json(sessions);
    } catch (e) {
        console.error("Fetch chats error:", e);
        res.status(500).json({ error: e.message });
    }
});

// POST /api/chats - Create a new empty chat session
app.post('/api/chats', softAuth, async (req, res) => {
    try {
        const { guestId, title, messages, model } = req.body;
        const newSession = await ChatSession.create({
            userId: req.user ? req.user.id : null,
            guestId: req.user ? null : guestId,
            title: title || 'New Chat',
            messages: messages || [],
            model: model || 'rag'
        });
        res.status(201).json(newSession);
    } catch (e) {
        console.error("Create chat error:", e);
        res.status(500).json({ error: e.message });
    }
});

// PUT /api/chats/:id - Sync/update an active chat session (messages, title, model)
app.put('/api/chats/:id', softAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const { title, messages, model } = req.body;
        
        let filter = { _id: id };
        if (req.user) {
            filter.userId = req.user.id;
        } else {
            const guestId = req.headers['x-guest-id'];
            if (!guestId) {
                return res.status(400).json({ error: 'Guest ID required' });
            }
            filter.userId = null;
            filter.guestId = guestId;
        }

        const updatedSession = await ChatSession.findOneAndUpdate(
            filter,
            { $set: { title, messages, model } },
            { new: true }
        );

        if (!updatedSession) {
            return res.status(404).json({ error: 'Chat session not found or unauthorized' });
        }
        res.json(updatedSession);
    } catch (e) {
        console.error("Update chat error:", e);
        res.status(500).json({ error: e.message });
    }
});

// DELETE /api/chats/:id - Delete a specific chat session
app.delete('/api/chats/:id', softAuth, async (req, res) => {
    try {
        const { id } = req.params;
        let filter = { _id: id };
        if (req.user) {
            filter.userId = req.user.id;
        } else {
            const guestId = req.headers['x-guest-id'];
            if (!guestId) {
                return res.status(400).json({ error: 'Guest ID required' });
            }
            filter.userId = null;
            filter.guestId = guestId;
        }

        const deletedSession = await ChatSession.findOneAndDelete(filter);
        if (!deletedSession) {
            return res.status(404).json({ error: 'Chat session not found or unauthorized' });
        }
        res.json({ message: 'Chat session deleted successfully' });
    } catch (e) {
        console.error("Delete chat error:", e);
        res.status(500).json({ error: e.message });
    }
});

// DELETE /api/chats - Clear all chats for active user or guest
app.delete('/api/chats', softAuth, async (req, res) => {
    try {
        let filter = {};
        if (req.user) {
            filter.userId = req.user.id;
        } else {
            const guestId = req.headers['x-guest-id'];
            if (!guestId) {
                return res.status(400).json({ error: 'Guest ID required' });
            }
            filter.userId = null;
            filter.guestId = guestId;
        }

        await ChatSession.deleteMany(filter);
        res.json({ message: 'All chat sessions deleted successfully' });
    } catch (e) {
        console.error("Clear chats error:", e);
        res.status(500).json({ error: e.message });
    }
});

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => console.log(`Server is running on port ${PORT}`));
