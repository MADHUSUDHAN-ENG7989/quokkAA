const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
    role: { type: String, enum: ['user', 'assistant'], required: true },
    content: { type: String, required: true },
    sources: [{ type: String }],
    isError: { type: Boolean, default: false },
    timestamp: { type: Date, default: Date.now }
});

const chatSessionSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    guestId: { type: String, default: null }, // For guest session persistence
    title: { type: String, default: 'New Chat' },
    messages: [messageSchema],
    model: { type: String, default: 'rag' }
}, { timestamps: true });

module.exports = mongoose.model('ChatSession', chatSessionSchema);
