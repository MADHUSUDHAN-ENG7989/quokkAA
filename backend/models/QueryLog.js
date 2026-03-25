const mongoose = require('mongoose');

const queryLogSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    userEmail: { type: String, default: 'guest' },
    query: { type: String, required: true },
    answer: { type: String, default: '' },
    sources: [{ type: String }],
    responseTimeMs: { type: Number, default: 0 },
    usedRagContext: { type: Boolean, default: false },
    timestamp: { type: Date, default: Date.now },
});

module.exports = mongoose.model('QueryLog', queryLogSchema);
