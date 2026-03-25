const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'quokka_fallback_secret';

const signToken = (user) => jwt.sign(
    { id: user._id, email: user.email, name: user.name, role: user.role },
    JWT_SECRET,
    { expiresIn: '7d' }
);

// POST /api/auth/register
router.post('/register', async (req, res) => {
    try {
        const { name, email, password } = req.body;
        if (!name || !email || !password)
            return res.status(400).json({ error: 'Name, email and password are required' });

        const existing = await User.findOne({ email });
        if (existing)
            return res.status(409).json({ error: 'Email already in use' });

        const user = await User.create({ name, email, password });
        const token = signToken(user);
        res.status(201).json({ token, user: { id: user._id, name: user.name, email: user.email, role: user.role } });
    } catch (e) {
        console.error('Register error:', e);
        res.status(500).json({ error: 'Registration failed' });
    }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password)
            return res.status(400).json({ error: 'Email and password are required' });

        const user = await User.findOne({ email });
        if (!user || !(await user.comparePassword(password)))
            return res.status(401).json({ error: 'Invalid email or password' });

        const token = signToken(user);
        res.json({ token, user: { id: user._id, name: user.name, email: user.email, role: user.role } });
    } catch (e) {
        console.error('Login error:', e);
        res.status(500).json({ error: 'Login failed' });
    }
});

// POST /api/auth/google
router.post('/google', async (req, res) => {
    try {
        const { googleId, email, name, picture } = req.body;
        if (!googleId || !email)
            return res.status(400).json({ error: 'Google user info required' });

        let user = await User.findOne({ $or: [{ googleId }, { email }] });
        if (!user) {
            user = await User.create({ name: name || email, email, googleId, password: null });
        } else if (!user.googleId) {
            user.googleId = googleId;
            await user.save();
        }

        const token = signToken(user);
        res.json({ token, user: { id: user._id, name: user.name, email: user.email, role: user.role, picture } });
    } catch (e) {
        console.error('Google auth error:', e);
        res.status(401).json({ error: 'Google authentication failed' });
    }
});


module.exports = router;
