import { useEffect, useState } from 'react';
import { supabase } from './supabaseClient';
import Login from './login';
import StockJournal from '../stock-journal';
import CookApp from './cook-app';

const baseStyle = {
  minHeight: '100vh',
  background: '#FAF8F5',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontFamily: '-apple-system, "Segoe UI", Roboto, sans-serif',
};

export default function App() {
  // undefined = still initialising, null = logged out
  const [session, setSession] = useState(undefined);
  const [profile, setProfile] = useState(null);
  const [profileError, setProfileError] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session ?? null);
      if (session) fetchProfile(session.user.id);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session ?? null);
      if (session) {
        fetchProfile(session.user.id);
      } else {
        setProfile(null);
        setProfileError(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  async function fetchProfile(userId) {
    setProfile(null);
    setProfileError(false);
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();
    if (error || !data) {
      setProfileError(true);
    } else {
      setProfile(data);
    }
  }

  if (session === undefined) {
    return (
      <div style={baseStyle}>
        <p style={{ color: '#6B6560' }}>Chargement...</p>
      </div>
    );
  }

  if (!session) return <Login />;

  if (profileError) {
    return (
      <div style={baseStyle}>
        <div style={{ textAlign: 'center', padding: 24 }}>
          <p style={{ color: '#C62828', fontWeight: 600, margin: '0 0 6px' }}>
            Compte non configuré.
          </p>
          <p style={{ color: '#6B6560', fontSize: 14, margin: '0 0 20px' }}>
            Contactez l'administrateur.
          </p>
          <button
            onClick={() => supabase.auth.signOut()}
            style={{
              padding: '8px 20px',
              background: '#2C2520',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontSize: 14,
            }}
          >
            Se déconnecter
          </button>
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div style={baseStyle}>
        <p style={{ color: '#6B6560' }}>Chargement du profil...</p>
      </div>
    );
  }

  if (profile.role === 'admin') return <StockJournal profile={profile} />;
  if (profile.role === 'cook') return <CookApp profile={profile} />;

  return (
    <div style={baseStyle}>
      <p style={{ color: '#C62828' }}>Rôle inconnu : {profile.role}</p>
    </div>
  );
}
