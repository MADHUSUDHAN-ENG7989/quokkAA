const express = require('express');
const router = express.Router();
const Razorpay = require('razorpay');
const crypto = require('crypto');
const { verifyToken } = require('../middleware/auth');
const User = require('../models/User');

const razorpay = new Razorpay({
    key_id: (process.env.RAZORPAY_KEY_ID || 'rzp_test_SlYQsdChlM0l0M').replace(/['"]/g, ''),
    key_secret: (process.env.RAZORPAY_KEY_SECRET || '2dDfZEqX7qWUp9SvDRnL6cOr').replace(/['"]/g, ''),
});

// @route   POST /api/payment/orders
// @desc    Create a Razorpay order for flat premium subscription (₹2400 INR)
router.post('/orders', verifyToken, async (req, res) => {
    try {
        const options = {
            amount: 2400 * 100, // ₹2400 INR in paise (approx $29 USD)
            currency: 'INR',
            receipt: 'rcpt_' + Date.now(),
        };

        const order = await razorpay.orders.create(options);
        if (!order) {
            return res.status(500).json({ error: 'Failed to create Razorpay order' });
        }
        res.json(order);
    } catch (err) {
        console.error('Razorpay Order Creation Error:', err);
        res.status(500).json({ error: 'Failed to initiate payment gateway: ' + (err.message || JSON.stringify(err)) });
    }
});

// @route   POST /api/payment/verify
// @desc    Verify payment signature and activate premium subscription in MongoDB
router.post('/verify', verifyToken, async (req, res) => {
    try {
        const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

        const body = razorpay_order_id + "|" + razorpay_payment_id;
        const secret = (process.env.RAZORPAY_KEY_SECRET || '2dDfZEqX7qWUp9SvDRnL6cOr').replace(/['"]/g, '');
        const expectedSignature = crypto
            .createHmac('sha256', secret)
            .update(body.toString())
            .digest('hex');

        if (expectedSignature === razorpay_signature) {
            // Payment verified successfully!
            const user = await User.findById(req.user.id);
            if (!user) {
                return res.status(404).json({ error: 'User not found' });
            }

            user.isSubscribed = true;
            // Generate active qk_ API key if not present
            if (!user.apiKey) {
                user.apiKey = 'qk_' + crypto.randomBytes(16).toString('hex');
            }
            await user.save();

            res.json({
                success: true,
                isSubscribed: user.isSubscribed,
                apiKey: user.apiKey,
                payment_id: razorpay_payment_id
            });
        } else {
            res.status(400).json({ error: 'Signature verification failed' });
        }
    } catch (err) {
        console.error('Razorpay Verification Error:', err.message);
        res.status(500).json({ error: 'Payment validation failed' });
    }
});

module.exports = router;
