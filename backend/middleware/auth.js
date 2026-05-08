const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'quokka_fallback_secret';

// Strict auth — blocks unauthenticated requests
const verifyToken = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'No token provided' });
    }
    const token = authHeader.split(' ')[1];
    try {
        req.user = jwt.verify(token, JWT_SECRET);
        next();
    } catch (e) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
};

const User = require('../models/User');

// Soft auth — attaches user if token or API key is present, but doesn't block guests (unless API key is invalid/unsubscribed)
const softAuth = async (req, res, next) => {
    const apiKey = req.headers['x-api-key'];

    if (apiKey) {
        try {
            const user = await User.findOne({ apiKey });
            if (!user) {
                return res.status(401).json({ error: 'Invalid API Key' });
            }
            if (!user.isSubscribed) {
                return res.status(402).json({ error: 'Active subscription required. Please subscribe to use Quokka API.' });
            }
            req.user = { id: user._id, name: user.name, email: user.email, role: user.role };
            return next();
        } catch (e) {
            return res.status(500).json({ error: 'Server error validating API Key' });
        }
    }

    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.split(' ')[1];
        try {
            req.user = jwt.verify(token, JWT_SECRET);
        } catch (_) {
            req.user = null;
        }
    } else {
        req.user = null;
    }
    next();
};

// Admin guard — must come after verifyToken
const requireAdmin = (req, res, next) => {
    if (!req.user || req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }
    next();
};

module.exports = { verifyToken, softAuth, requireAdmin };
