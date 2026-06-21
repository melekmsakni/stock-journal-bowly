import { useEffect, useState } from 'react';
import { supabase } from './supabaseClient';

function getTodayStr() {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

function formatDateLong(str) {
  const [y, m, d] = str.split('-');
  const months = [
    'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
    'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
  ];
  return `${parseInt(d)} ${months[parseInt(m) - 1]} ${y}`;
}

function formatTime(isoStr) {
  // Convert UTC to Tunisia time (UTC+1)
  const d = new Date(new Date(isoStr).getTime() + 60 * 60 * 1000);
  return d.toISOString().slice(11, 16);
}

function unitLabel(unit) {
  if (unit === 'kg') return 'KG';
  if (unit === 'l') return 'L';
  return 'Portions';
}

const colors = {
  bg: '#FAF8F5',
  card: '#FFFFFF',
  text: '#1A1A1A',
  textMuted: '#6B6560',
  border: '#E8E4DF',
  accent: '#C4841D',
  accentLight: '#FFF3E0',
  green: '#2E7D32',
  greenBg: '#E8F5E9',
  red: '#C62828',
  redBg: '#FFEBEE',
  dark: '#2C2520',
};

export default function CookApp({ profile }) {
  const [items, setItems] = useState([]);
  const [counts, setCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submittedAt, setSubmittedAt] = useState(null);
  const [isModifying, setIsModifying] = useState(false);
  const [error, setError] = useState('');
  const [history, setHistory] = useState([]);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    loadItems();
    loadHistory();

    const channel = supabase
      .channel('cook-stock-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'stock_history' }, () => {
        loadItems();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  async function loadItems() {
    setLoading(true);
    const today = getTodayStr();
    const [{ data: itemData, error: rpcError }, { data: submissionData }] = await Promise.all([
      supabase.rpc('get_today_items', { p_cook_id: profile.id }),
      supabase
        .from('cook_counts')
        .select('item_name, count, submitted_at')
        .eq('cook_id', profile.id)
        .eq('date', today)
        .order('submitted_at', { ascending: false }),
    ]);

    if (rpcError) {
      setError('RPC error: ' + rpcError.message);
      setLoading(false);
      return;
    }

    const list = itemData || [];
    setItems(list);

    if (submissionData && submissionData.length > 0) {
      const latestAt = submissionData[0].submitted_at;
      setSubmittedAt(latestAt);
      // Pre-fill counts from the most recent submission batch
      const init = {};
      list.forEach(item => { init[item.name] = ''; });
      submissionData
        .filter(r => r.submitted_at === latestAt)
        .forEach(r => { init[r.item_name] = String(r.count); });
      setCounts(init);
    } else {
      setSubmittedAt(null);
      const init = {};
      list.forEach(item => { init[item.name] = ''; });
      setCounts(init);
    }
    setLoading(false);
  }

  async function loadHistory() {
    const today = getTodayStr();
    const { data } = await supabase
      .from('cook_counts')
      .select('date, item_name, count, unit, submitted_at')
      .eq('cook_id', profile.id)
      .lt('date', today)
      .order('date', { ascending: false })
      .order('submitted_at', { ascending: false });

    if (!data || data.length === 0) { setHistory([]); return; }

    // Group by date, then take only the most recent submission per date
    const byDate = {};
    data.forEach(row => {
      if (!byDate[row.date]) byDate[row.date] = { submittedAt: row.submitted_at, items: [] };
      // Only add items from the most recent batch for this date
      if (row.submitted_at === byDate[row.date].submittedAt) {
        byDate[row.date].items.push({ name: row.item_name, count: row.count, unit: row.unit });
      }
    });

    setHistory(Object.entries(byDate).map(([date, val]) => ({ date, ...val })));
  }

  async function handleSubmit() {
    setError('');
    setSubmitting(true);
    const today = getTodayStr();
    const submittedAtISO = new Date().toISOString();
    const rows = items.map(item => ({
      cook_id: profile.id,
      date: today,
      item_name: item.name,
      unit: item.unit || 'portions',
      count: Math.max(0, parseFloat(counts[item.name]) || 0),
      submitted_at: submittedAtISO,
    }));

    const { error: insertError } = await supabase.from('cook_counts').insert(rows);
    if (insertError) {
      setError('Erreur lors de la soumission. Réessayez.');
    } else {
      setSubmittedAt(submittedAtISO);
      setIsModifying(false);
    }
    setSubmitting(false);
  }

  function handleModify() {
    setIsModifying(true);
    setError('');
  }

  function cancelModify() {
    setIsModifying(false);
    setError('');
  }

  if (loading) {
    return (
      <div style={{
        minHeight: '100vh',
        background: colors.bg,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: '-apple-system, "Segoe UI", Roboto, sans-serif',
      }}>
        <p style={{ color: colors.textMuted }}>Chargement...</p>
      </div>
    );
  }

  return (
    <div style={{
      fontFamily: '-apple-system, "Segoe UI", Roboto, sans-serif',
      background: colors.bg,
      minHeight: '100vh',
      color: colors.text,
      maxWidth: 480,
      margin: '0 auto',
      paddingBottom: 100,
    }}>
      {/* Header */}
      <div style={{ background: colors.dark, color: '#fff', padding: '20px 16px 16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: 13, opacity: 0.65, marginBottom: 2 }}>Bonjour,</div>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>{profile.full_name}</h1>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
              <div style={{ fontSize: 13, opacity: 0.55 }}>{formatDateLong(getTodayStr())}</div>
              {profile.shift && (
                <span style={{
                  fontSize: 11, fontWeight: 600, padding: '2px 8px',
                  background: 'rgba(255,255,255,0.15)', borderRadius: 20,
                  textTransform: 'capitalize',
                }}>
                  {profile.shift === 'après-midi' ? 'Après-midi' : profile.shift === 'journée' ? 'Journée' : 'Matin'}
                </span>
              )}
            </div>
          </div>
          <button
            onClick={() => supabase.auth.signOut()}
            style={{
              background: 'rgba(255,255,255,0.12)',
              border: 'none',
              color: '#fff',
              padding: '6px 12px',
              borderRadius: 6,
              fontSize: 13,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            Se déconnecter
          </button>
        </div>
      </div>

      {submittedAt && !isModifying ? (
        /* Confirmation screen */
        (() => {
          const submittedMs = new Date(submittedAt).getTime();
          const withinWindow = (Date.now() - submittedMs) < 5 * 60 * 1000;
          const submittedTime = formatTime(submittedAt);
          const deadlineTime = formatTime(new Date(submittedMs + 5 * 60 * 1000).toISOString());
          return (
            <div style={{
              margin: '32px 16px',
              padding: 28,
              background: colors.greenBg,
              borderRadius: 16,
              textAlign: 'center',
              border: '1px solid ' + colors.green + '33',
            }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>✓</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: colors.green, marginBottom: 6 }}>
                Comptage enregistré
              </div>
              <div style={{ fontSize: 14, color: colors.textMuted, marginBottom: 24 }}>
                à {submittedTime}
              </div>
              {withinWindow && (
                <>
                  <div style={{ fontSize: 12, color: colors.textMuted, marginBottom: 16 }}>
                    Modifiable jusqu'à {deadlineTime}
                  </div>
                  <button
                    onClick={handleModify}
                    style={{
                      padding: '10px 28px',
                      background: colors.dark,
                      color: '#fff',
                      border: 'none',
                      borderRadius: 8,
                      fontSize: 14,
                      fontWeight: 600,
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                    }}
                  >
                    Modifier
                  </button>
                </>
              )}
            </div>
          );
        })()
      ) : (
        <>
          <div style={{ padding: '16px 16px 8px' }}>
            <div style={{ fontSize: 17, fontWeight: 700 }}>
              {isModifying ? 'Modifier le comptage' : 'Comptage du stock'}
            </div>
            <div style={{ fontSize: 13, color: colors.textMuted, marginTop: 3 }}>
              {isModifying
                ? 'Modifiez les quantités puis soumettez à nouveau.'
                : 'Entrez les quantités que vous voyez actuellement.'}
            </div>
          </div>

          <div style={{ padding: '4px 16px' }}>
            {items.length === 0 ? (
              <p style={{ textAlign: 'center', color: colors.textMuted, padding: '32px 0' }}>
                Aucun article disponible pour aujourd'hui.
              </p>
            ) : (
              items.map(item => (
                <div
                  key={item.name}
                  style={{
                    background: colors.card,
                    borderRadius: 10,
                    padding: '12px 14px',
                    marginBottom: 8,
                    border: '1px solid ' + colors.border,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 600 }}>{item.name}</div>
                    <div style={{ fontSize: 12, color: colors.textMuted, marginTop: 2 }}>
                      {unitLabel(item.unit)}
                    </div>
                  </div>
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="any"
                    value={counts[item.name]}
                    onChange={e => setCounts(prev => ({ ...prev, [item.name]: e.target.value }))}
                    placeholder="0"
                    style={{
                      width: 80,
                      padding: '8px',
                      border: '1px solid ' + colors.accent,
                      borderRadius: 8,
                      fontSize: 18,
                      fontWeight: 600,
                      textAlign: 'center',
                      background: colors.accentLight,
                      fontFamily: 'inherit',
                      color: colors.text,
                    }}
                  />
                </div>
              ))
            )}
          </div>

          {error && (
            <div style={{
              margin: '0 16px 12px',
              padding: 12,
              background: colors.redBg,
              color: colors.red,
              borderRadius: 8,
              fontSize: 13,
            }}>
              {error}
            </div>
          )}

          {items.length > 0 && (
            <div style={{ padding: '8px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button
                onClick={handleSubmit}
                disabled={submitting}
                style={{
                  width: '100%',
                  padding: 14,
                  background: submitting ? colors.textMuted : colors.dark,
                  color: '#fff',
                  border: 'none',
                  borderRadius: 10,
                  fontSize: 16,
                  fontWeight: 700,
                  cursor: submitting ? 'default' : 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                {submitting ? 'Enregistrement...' : isModifying ? 'Mettre à jour' : 'Soumettre mon comptage'}
              </button>
              {isModifying && (
                <button
                  onClick={cancelModify}
                  style={{
                    width: '100%',
                    padding: 12,
                    background: 'transparent',
                    color: colors.textMuted,
                    border: '1px solid ' + colors.border,
                    borderRadius: 10,
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                  }}
                >
                  Annuler
                </button>
              )}
            </div>
          )}
        </>
      )}
      {/* History section */}
      {history.length > 0 && (
        <div style={{ padding: '8px 16px 0' }}>
          <button
            onClick={() => setShowHistory(prev => !prev)}
            style={{
              width: '100%',
              padding: '12px 16px',
              background: colors.card,
              border: '1px solid ' + colors.border,
              borderRadius: 10,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontSize: 14,
              fontWeight: 600,
              color: colors.text,
            }}
          >
            <span>Historique des comptages</span>
            <span style={{ color: colors.textMuted, fontSize: 12 }}>
              {history.length} jour{history.length > 1 ? 's' : ''} {showHistory ? '▲' : '▼'}
            </span>
          </button>

          {showHistory && (
            <div style={{ marginTop: 8 }}>
              {history.map(day => (
                <div key={day.date} style={{
                  background: colors.card,
                  border: '1px solid ' + colors.border,
                  borderRadius: 10,
                  marginBottom: 8,
                  overflow: 'hidden',
                }}>
                  <div style={{
                    padding: '10px 14px',
                    background: colors.bg,
                    borderBottom: '1px solid ' + colors.border,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}>
                    <span style={{ fontWeight: 700, fontSize: 14 }}>{formatDateLong(day.date)}</span>
                    <span style={{ fontSize: 12, color: colors.textMuted }}>
                      soumis à {formatTime(day.submittedAt)}
                    </span>
                  </div>
                  {day.items.map(item => (
                    <div key={item.name} style={{
                      padding: '8px 14px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      borderBottom: '1px solid ' + colors.border + '66',
                    }}>
                      <span style={{ fontSize: 14, color: colors.text }}>{item.name}</span>
                      <span style={{ fontSize: 14, fontWeight: 600, color: colors.accent }}>
                        {item.count} <span style={{ fontSize: 11, color: colors.textMuted, fontWeight: 400 }}>{unitLabel(item.unit)}</span>
                      </span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
