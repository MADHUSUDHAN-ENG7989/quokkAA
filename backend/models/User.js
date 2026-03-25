const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, default: null }, // null for Google-only users
    googleId: { type: String, default: null },
    role: { type: String, enum: ['public', 'admin'], default: 'public' },
}, { timestamps: true });

// Hash password before saving
userSchema.pre('save', async function () {
    if (!this.isModified('password') || !this.password) return;
    this.password = await bcrypt.hash(this.password, 12);
});

// Compare password
userSchema.methods.comparePassword = async function (candidate) {
    if (!this.password) return false;
    return bcrypt.compare(candidate, this.password);
};

module.exports = mongoose.model('User', userSchema);
