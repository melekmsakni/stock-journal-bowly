import { useState } from 'react';
import { supabase } from './supabaseClient';

const colors = {
  bg: '#FAF8F5',
  card: '#FFFFFF',
  text: '#1A1A1A',
  textMuted: '#6B6560',
  border: '#E8E4DF',
  accent: '#C4841D',
  red: '#C62828',
  redBg: '#FFEBEE',
  dark: '#2C2520',
};

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleLogin(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    const { error: authError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (authError) {
      if (authError.message.includes('Invalid login credentials')) {
        setError('Email ou mot de passe incorrect.');
      } else if (authError.message.includes('Email not confirmed')) {
        setError("Votre email n'a pas encore été confirmé.");
      } else {
        setError('Erreur de connexion. Réessayez.');
      }
    }
    setLoading(false);
  }

  const field = {
    width: '100%',
    padding: '10px 12px',
    boxSizing: 'border-box',
    border: '1px solid ' + colors.border,
    borderRadius: 8,
    fontSize: 15,
    fontFamily: 'inherit',
    background: '#fff',
    outline: 'none',
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: colors.bg,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 16,
      fontFamily: '-apple-system, "Segoe UI", Roboto, sans-serif',
    }}>
      <div style={{ width: '100%', maxWidth: 360 }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{
            width: 56, height: 56, borderRadius: 16,
            background: colors.dark, margin: '0 auto 16px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 26,
          }}>
            📦
          </div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: colors.text }}>
            Journal de Stock
          </h1>
          <p style={{ margin: '6px 0 0', fontSize: 14, color: colors.textMuted }}>
            Connectez-vous pour continuer
          </p>
        </div>

        <div style={{
          background: colors.card,
          borderRadius: 16,
          padding: 24,
          border: '1px solid ' + colors.border,
        }}>
          <form onSubmit={handleLogin}>
            <div style={{ marginBottom: 14 }}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: colors.text, marginBottom: 6 }}>
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoComplete="email"
                placeholder="votre@email.com"
                style={field}
              />
            </div>

            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: colors.text, marginBottom: 6 }}>
                Mot de passe
              </label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                placeholder="••••••••"
                style={field}
              />
            </div>

            {error && (
              <div style={{
                background: colors.redBg,
                color: colors.red,
                border: '1px solid ' + colors.red + '33',
                borderRadius: 8,
                padding: '10px 12px',
                fontSize: 13,
                marginBottom: 16,
              }}>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              style={{
                width: '100%',
                padding: 12,
                background: loading ? colors.textMuted : colors.dark,
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                fontSize: 15,
                fontWeight: 600,
                cursor: loading ? 'default' : 'pointer',
                fontFamily: 'inherit',
              }}
            >
              {loading ? 'Connexion...' : 'Se connecter'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
