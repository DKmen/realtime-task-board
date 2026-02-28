import React, { useState } from 'react';
import { authLogin } from '../api';
import { useUser } from '../context/UserContext';

export const LoginPage = () => {
  const { setUser } = useUser();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const user = await authLogin(email.trim());
      setUser(user);
    } catch {
      setError('Login failed. Please check your email and try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <h1>Task Board</h1>
        <p className="login-subtitle">Enter your email to join</p>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
            />
          </div>
          {error && <p className="form-error">{error}</p>}
          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? 'Joining…' : 'Join Board'}
          </button>
        </form>
      </div>
    </div>
  );
};
