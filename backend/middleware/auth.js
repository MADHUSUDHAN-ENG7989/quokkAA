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

// Soft auth — attaches user if token present, but doesn't block guests
const softAuth = (req, res, next) => {
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
