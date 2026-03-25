import { useState } from 'react';
import { useGoogleLogin } from '@react-oauth/google';
import { useAuth } from '../context/AuthContext';
import './AuthModal.css';

const API = 'http://localhost:8000';

export default function AuthModal({ onClose }) {
    const { login } = useAuth();
    const [mode, setMode] = useState('login'); // 'login' | 'register'
    const [form, setForm] = useState({ name: '', email: '', password: '' });
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const handleChange = (e) => setForm(f => ({ ...f, [e.target.name]: e.target.value }));

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);
        try {
            const endpoint = mode === 'login' ? '/api/auth/login' : '/api/auth/register';
            const body = mode === 'login'
                ? { email: form.email, password: form.password }
                : { name: form.name, email: form.email, password: form.password };

            const res = await fetch(`${API}${endpoint}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Something went wrong');
            login(data.token, data.user);
            onClose();
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const googleLogin = useGoogleLogin({
        onSuccess: async (tokenResponse) => {
            setLoading(true);
            setError('');
            try {
                // Exchange access token for user info
                const userInfo = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
                    headers: { Authorization: `Bearer ${tokenResponse.access_token}` },
                }).then(r => r.json());

                // Send to our backend
                const res = await fetch(`${API}/api/auth/google`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        googleId: userInfo.sub, 
                        email: userInfo.email, 
                        name: userInfo.name,
                        picture: userInfo.picture
                    }),
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || 'Google login failed');
                login(data.token, data.user);
                onClose();
            } catch (err) {
                setError(err.message);
            } finally {
                setLoading(false);
            }
        },
        onError: () => setError('Google login was cancelled or failed.'),
    });

    return (
        <div className="auth-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
            <div className="auth-modal">
                <button className="auth-close" onClick={onClose}>×</button>

                <div className="auth-header">
                    <div className="auth-logo">
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
                        </svg>
                    </div>
                    <h2>{mode === 'login' ? 'Welcome back' : 'Create account'}</h2>
                    <p className="auth-subtext">
                        {mode === 'login'
                            ? "You've used your 3 free queries. Login to continue."
                            : 'Join Quokka — your material science AI assistant.'}
                    </p>
                </div>

                {/* Google Button */}
                <button className="google-btn" onClick={() => googleLogin()} disabled={loading}>
                    <svg width="18" height="18" viewBox="0 0 24 24">
                        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                    </svg>
                    Continue with Google
                </button>

                <div className="auth-divider"><span>or</span></div>

                {/* Email/Password Form */}
                <form className="auth-form" onSubmit={handleSubmit}>
                    {mode === 'register' && (
                        <div className="form-group">
                            <label>Full Name</label>
                            <input
                                type="text" name="name" placeholder="Your name"
                                value={form.name} onChange={handleChange} required
                            />
                        </div>
                    )}
                    <div className="form-group">
                        <label>Email</label>
                        <input
                            type="email" name="email" placeholder="you@example.com"
                            value={form.email} onChange={handleChange} required
                        />
                    </div>
                    <div className="form-group">
                        <label>Password</label>
                        <input
                            type="password" name="password" placeholder="••••••••"
                            value={form.password} onChange={handleChange} required minLength={6}
                        />
                    </div>

                    {error && <p className="auth-error">{error}</p>}

                    <button type="submit" className="auth-submit-btn" disabled={loading}>
                        {loading ? 'Please wait...' : mode === 'login' ? 'Sign In' : 'Create Account'}
                    </button>
                </form>

                <p className="auth-toggle">
                    {mode === 'login' ? "Don't have an account? " : "Already have an account? "}
                    <button onClick={() => { setMode(m => m === 'login' ? 'register' : 'login'); setError(''); }}>
                        {mode === 'login' ? 'Register' : 'Sign in'}
                    </button>
                </p>
            </div>
        </div>
    );
}
