require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const { rag } = require('./rag');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const { liveRag } = require('./live-rag');
const { hybridRag } = require('./hybrid-rag');
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const paymentRoutes = require('./routes/payment');
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

// Payment routes (protected)
app.use('/api/payment', paymentRoutes);

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

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

app.post('/api/summarize', softAuth, upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded.' });
        }

        const fileName = req.file.originalname;
        const mimeType = req.file.mimetype;
        let textContent = '';

        if (mimeType === 'application/pdf') {
            const parser = new pdfParse.PDFParse(new Uint8Array(req.file.buffer));
            const data = await parser.getText();
            textContent = data.text;
        } else if (mimeType === 'text/plain' || mimeType === 'text/markdown' || fileName.endsWith('.md') || fileName.endsWith('.txt')) {
            textContent = req.file.buffer.toString('utf-8');
        } else {
            return res.status(400).json({ error: 'Unsupported file type. Please upload a PDF, TXT, or MD file.' });
        }

        if (!textContent || !textContent.trim()) {
            return res.status(400).json({ error: 'The uploaded file is empty or contains no extractable text.' });
        }

        // Limit length to respect model context
        const charLimit = 16000;
        let isTruncated = false;
        if (textContent.length > charLimit) {
            textContent = textContent.substring(0, charLimit);
            isTruncated = true;
        }

        const systemPrompt = `You are an elite research paper synthesizer and scientific writer. 
Generate a comprehensive, structured, and professional summary of the provided document.
Your summary must include:
- **Core Objective & Background** (1-2 sentences)
- **Key Methodologies / Concepts** (structured bullet points)
- **Main Findings & Experimental Results** (detailed bullet points or tables if applicable)
- **Significance & Research Implications** (conclusions)

Maintain a highly professional, academic, and technical tone. Use markdown formatting to make the summary incredibly legible and engaging.`;

        const userPrompt = `Document Name: ${fileName}${isTruncated ? ' (Truncated due to length)' : ''}\n\nContent:\n${textContent}`;

        if (!rag.groq) {
            return res.status(500).json({ error: 'Groq LLM Service is not configured on the server.' });
        }

        const completion = await rag.groq.chat.completions.create({
            model: "llama-3.1-8b-instant",
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ],
            temperature: 0.5,
            max_tokens: 1500
        });

        const summary = completion.choices[0].message.content || 'Failed to generate summary.';

        const initialUserMessage = { 
            role: 'user', 
            content: `Please summarize the attached document: **${fileName}**` 
        };
        const assistantMessage = { 
            role: 'assistant', 
            content: summary,
            sources: []
        };

        const newSession = await ChatSession.create({
            userId: req.user ? req.user.id : null,
            guestId: req.user ? null : (req.headers['x-guest-id'] || req.body.guestId || 'g_anonymous'),
            title: `Summary: ${fileName.substring(0, 30)}`,
            messages: [initialUserMessage, assistantMessage],
            model: 'rag'
        });

        res.status(201).json(newSession);

    } catch (e) {
        console.error('Error during summarization:', e);
        res.status(500).json({ error: e.message });
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
