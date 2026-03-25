const express = require('express');
const QueryLog = require('../models/QueryLog');

const router = express.Router();

// GET /api/admin/logs?page=1&limit=20
router.get('/logs', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const skip = (page - 1) * limit;

        const [logs, total] = await Promise.all([
            QueryLog.find().sort({ timestamp: -1 }).skip(skip).limit(limit).lean(),
            QueryLog.countDocuments()
        ]);

        res.json({ logs, total, page, totalPages: Math.ceil(total / limit) });
    } catch (e) {
        console.error('Admin logs error:', e);
        res.status(500).json({ error: 'Failed to fetch logs' });
    }
});

// GET /api/admin/metrics
router.get('/metrics', async (req, res) => {
    try {
        const total = await QueryLog.countDocuments();
        const ragHits = await QueryLog.countDocuments({ usedRagContext: true });

        const avgResult = await QueryLog.aggregate([
            { $group: { _id: null, avgTime: { $avg: '$responseTimeMs' } } }
        ]);

        const avgResponseTime = avgResult.length > 0 ? Math.round(avgResult[0].avgTime) : 0;
        const ragHitRate = total > 0 ? Math.round((ragHits / total) * 100) : 0;

        // Queries per day (last 7 days)
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const queriesPerDay = await QueryLog.aggregate([
            { $match: { timestamp: { $gte: sevenDaysAgo } } },
            { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } }, count: { $sum: 1 } } },
            { $sort: { _id: 1 } }
        ]);

        // Top queries (most repeated)
        const topQueries = await QueryLog.aggregate([
            { $group: { _id: '$query', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 5 }
        ]);

        res.json({ total, ragHits, ragHitRate, avgResponseTime, queriesPerDay, topQueries });
    } catch (e) {
        console.error('Admin metrics error:', e);
        res.status(500).json({ error: 'Failed to fetch metrics' });
    }
});

module.exports = router;
