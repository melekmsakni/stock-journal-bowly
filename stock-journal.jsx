import { useCallback, useEffect, useState } from 'react';
import { supabase } from './src/supabaseClient';

const PHASES = ["opening", "midday", "closing"];
const PHASE_LABELS = {
  opening: "Stock d'ouverture",
  midday: "Ventes du matin",
  closing: "Ventes de l'après-midi",
};

const DEFAULT_ITEMS = [
  "Saumon fumé",
  "Bœuf",
  "Crevette",
  "Poulet",
  "Bœuf fromage",
  "Haloumi",
  "Saumon",
  "Poulet fromage",
];

const HISTORY_TABLE = 'stock_history';

function getTodayStr() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

function formatDate(str) {
  const [y, m, d] = str.split("-");
  return `${d}/${m}/${y}`;
}

// Storage helpers
async function saveDay(dateStr, data) {
  try {
    await window.storage.set(`day:${dateStr}`, JSON.stringify(data));
    if (supabase) {
      await supabase.from(HISTORY_TABLE).upsert(
        {
          date: dateStr,
          items: data.items || [],
          phase: data.phase || 'opening',
          actual_stock: data.actualStock || {},
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'date' },
      );
    }
  } catch (e) {
    console.error("Save failed", e);
  }
}

async function loadDay(dateStr) {
  try {
    const result = await window.storage.get(`day:${dateStr}`);
    if (result) {
      return JSON.parse(result.value);
    }
    if (supabase) {
      const { data, error } = await supabase
        .from(HISTORY_TABLE)
        .select('items, phase, actual_stock')
        .eq('date', dateStr)
        .maybeSingle();
      if (!error && data) {
        return {
          items: data.items || [],
          phase: data.phase || 'opening',
          actualStock: data.actual_stock || {},
        };
      }
    }
    return null;
  } catch {
    return null;
  }
}

async function loadAllDayKeys() {
  try {
    if (supabase) {
      const { data, error } = await supabase
        .from(HISTORY_TABLE)
        .select('date')
        .order('date', { ascending: false });
      if (!error && data) {
        return data.map((row) => `day:${row.date}`);
      }
    }
    const result = await window.storage.list("day:");
    return result?.keys || [];
  } catch {
    return [];
  }
}

export default function StockJournal() {
  const [view, setView] = useState("today"); // today | history
  const [date, setDate] = useState(getTodayStr());
  const [items, setItems] = useState([]);
  const [phase, setPhase] = useState("opening");
  const [newItemName, setNewItemName] = useState("");
  const [loading, setLoading] = useState(true);
  const [historyKeys, setHistoryKeys] = useState([]);
  const [showAddItem, setShowAddItem] = useState(false);
  const [actualStock, setActualStock] = useState({});
  const [showVerify, setShowVerify] = useState(false);

  // Load day data
  const loadDayData = useCallback(async (d) => {
    setLoading(true);
    const data = await loadDay(d);
    if (data) {
      setItems(data.items || []);
      setPhase(data.phase || "opening");
      setActualStock(data.actualStock || {});
    } else {
      setItems(
        DEFAULT_ITEMS.map((name) => ({
          name,
          opening: 0,
          morningUsed: 0,
          afternoonUsed: 0,
        }))
      );
      setPhase("opening");
      setActualStock({});
    }
    setShowVerify(false);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadDayData(date);
  }, [date, loadDayData]);

  // Auto-save
  const save = useCallback(
    async (newItems, newPhase, newActual) => {
      await saveDay(date, {
        items: newItems ?? items,
        phase: newPhase ?? phase,
        actualStock: newActual ?? actualStock,
      });
    },
    [date, items, phase, actualStock]
  );

  // Load history
  useEffect(() => {
    if (view === "history") {
      loadAllDayKeys().then((keys) => {
        const dates = keys.map((k) => k.replace("day:", "")).sort().reverse();
        setHistoryKeys(dates);
      });
    }
  }, [view]);

  function updateItem(index, field, value) {
    const v = Math.max(0, parseInt(value) || 0);
    const next = items.map((item, i) =>
      i === index ? { ...item, [field]: v } : item
    );
    setItems(next);
    save(next, phase, actualStock);
  }

  function addItem() {
    if (!newItemName.trim()) return;
    const next = [
      ...items,
      { name: newItemName.trim(), opening: 0, morningUsed: 0, afternoonUsed: 0 },
    ];
    setItems(next);
    setNewItemName("");
    setShowAddItem(false);
    save(next, phase, actualStock);
  }

  function removeItem(index) {
    const next = items.filter((_, i) => i !== index);
    setItems(next);
    save(next, phase, actualStock);
  }

  function advancePhase() {
    const idx = PHASES.indexOf(phase);
    if (idx < PHASES.length - 1) {
      const next = PHASES[idx + 1];
      setPhase(next);
      save(items, next, actualStock);
    }
  }

  function goBackPhase() {
    const idx = PHASES.indexOf(phase);
    if (idx > 0) {
      const prev = PHASES[idx - 1];
      setPhase(prev);
      save(items, prev, actualStock);
    }
  }

  function getRemaining(item, afterPhase) {
    if (afterPhase === "opening") return item.opening;
    if (afterPhase === "midday") return item.opening - item.morningUsed;
    return item.opening - item.morningUsed - item.afternoonUsed;
  }

  function updateActual(itemName, value) {
    const v = Math.max(0, parseInt(value) || 0);
    const next = { ...actualStock, [itemName]: v };
    setActualStock(next);
    save(items, phase, next);
  }

  function toggleVerify() {
    if (!showVerify) {
      // Pre-fill actual with expected
      const prefill = {};
      items.forEach((item) => {
        if (actualStock[item.name] === undefined) {
          prefill[item.name] = getRemaining(item, phase);
        } else {
          prefill[item.name] = actualStock[item.name];
        }
      });
      setActualStock(prefill);
      save(items, phase, prefill);
    }
    setShowVerify(!showVerify);
  }

  function deleteHistoryEntry(dateStr) {
    setHistoryKeys((prev) => prev.filter((d) => d !== dateStr));
  }

  // Styles
  const colors = {
    bg: "#FAF8F5",
    card: "#FFFFFF",
    text: "#1A1A1A",
    textMuted: "#6B6560",
    border: "#E8E4DF",
    accent: "#C4841D",
    accentLight: "#FFF3E0",
    green: "#2E7D32",
    greenBg: "#E8F5E9",
    red: "#C62828",
    redBg: "#FFEBEE",
    blue: "#1565C0",
    blueBg: "#E3F2FD",
  };

  const s = {
    app: {
      fontFamily: '-apple-system, "Segoe UI", Roboto, sans-serif',
      background: colors.bg,
      minHeight: "100vh",
      color: colors.text,
      maxWidth: 480,
      margin: "0 auto",
      padding: "0 0 100px",
    },
    header: {
      background: "#2C2520",
      color: "#fff",
      padding: "20px 16px 16px",
      position: "sticky",
      top: 0,
      zIndex: 10,
    },
    title: {
      fontSize: 20,
      fontWeight: 700,
      margin: 0,
      letterSpacing: "-0.3px",
    },
    dateRow: {
      display: "flex",
      alignItems: "center",
      gap: 8,
      marginTop: 8,
    },
    dateInput: {
      background: "rgba(255,255,255,0.12)",
      border: "none",
      color: "#fff",
      padding: "6px 10px",
      borderRadius: 6,
      fontSize: 14,
      fontFamily: "inherit",
    },
    tabs: {
      display: "flex",
      gap: 0,
      marginTop: 12,
    },
    tab: (active) => ({
      flex: 1,
      padding: "8px 0",
      textAlign: "center",
      fontSize: 13,
      fontWeight: active ? 600 : 400,
      color: active ? "#fff" : "rgba(255,255,255,0.5)",
      borderBottom: active ? "2px solid " + colors.accent : "2px solid transparent",
      cursor: "pointer",
      background: "none",
      border: "none",
      borderBottomWidth: 2,
      borderBottomStyle: "solid",
      borderBottomColor: active ? colors.accent : "transparent",
      fontFamily: "inherit",
    }),
    phaseBar: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "12px 16px",
      background: colors.accentLight,
      borderBottom: "1px solid " + colors.border,
    },
    phaseLabel: {
      fontSize: 14,
      fontWeight: 600,
      color: colors.accent,
    },
    phaseNav: {
      display: "flex",
      gap: 6,
    },
    phaseBtn: (disabled) => ({
      padding: "5px 12px",
      fontSize: 13,
      border: "1px solid " + (disabled ? colors.border : colors.accent),
      background: disabled ? colors.bg : colors.accent,
      color: disabled ? colors.textMuted : "#fff",
      borderRadius: 6,
      cursor: disabled ? "default" : "pointer",
      fontFamily: "inherit",
      fontWeight: 500,
      opacity: disabled ? 0.5 : 1,
    }),
    section: {
      padding: "8px 16px",
    },
    itemCard: {
      background: colors.card,
      borderRadius: 10,
      padding: "12px 14px",
      marginBottom: 8,
      border: "1px solid " + colors.border,
    },
    itemHeader: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 6,
    },
    itemName: {
      fontSize: 15,
      fontWeight: 600,
    },
    removeBtn: {
      background: "none",
      border: "none",
      color: colors.textMuted,
      fontSize: 18,
      cursor: "pointer",
      padding: "0 4px",
      lineHeight: 1,
    },
    row: {
      display: "flex",
      alignItems: "center",
      gap: 8,
      marginTop: 4,
    },
    label: {
      fontSize: 12,
      color: colors.textMuted,
      minWidth: 80,
    },
    input: (highlight) => ({
      width: 64,
      padding: "6px 8px",
      border: "1px solid " + (highlight ? colors.accent : colors.border),
      borderRadius: 6,
      fontSize: 16,
      fontFamily: "inherit",
      textAlign: "center",
      background: highlight ? colors.accentLight : "#fff",
      fontWeight: highlight ? 600 : 400,
    }),
    remaining: (val) => ({
      fontSize: 13,
      fontWeight: 600,
      color: val < 0 ? colors.red : colors.green,
      marginLeft: "auto",
    }),
    addArea: {
      padding: "8px 16px 16px",
    },
    addBtn: {
      width: "100%",
      padding: "10px",
      border: "1px dashed " + colors.border,
      borderRadius: 10,
      background: "none",
      color: colors.textMuted,
      fontSize: 14,
      cursor: "pointer",
      fontFamily: "inherit",
    },
    addRow: {
      display: "flex",
      gap: 8,
    },
    addInput: {
      flex: 1,
      padding: "10px 12px",
      border: "1px solid " + colors.border,
      borderRadius: 8,
      fontSize: 15,
      fontFamily: "inherit",
    },
    confirmBtn: {
      padding: "10px 16px",
      background: colors.accent,
      color: "#fff",
      border: "none",
      borderRadius: 8,
      fontSize: 14,
      fontWeight: 600,
      cursor: "pointer",
      fontFamily: "inherit",
    },
    verifyBtn: {
      margin: "12px 16px",
      padding: "12px",
      background: showVerify ? colors.text : colors.blueBg,
      color: showVerify ? "#fff" : colors.blue,
      border: "none",
      borderRadius: 10,
      fontSize: 14,
      fontWeight: 600,
      cursor: "pointer",
      fontFamily: "inherit",
      width: "calc(100% - 32px)",
    },
    verifyCard: (diff) => ({
      background: diff === 0 ? colors.greenBg : colors.redBg,
      borderRadius: 10,
      padding: "10px 14px",
      marginBottom: 6,
      border:
        "1px solid " +
        (diff === 0 ? colors.green + "33" : colors.red + "33"),
    }),
    diffBadge: (diff) => ({
      fontSize: 13,
      fontWeight: 700,
      color: diff === 0 ? colors.green : colors.red,
    }),
    summaryBar: {
      padding: "12px 16px",
      background: colors.card,
      borderTop: "1px solid " + colors.border,
      borderBottom: "1px solid " + colors.border,
      marginBottom: 8,
    },
    summaryText: {
      fontSize: 13,
      color: colors.textMuted,
      display: "flex",
      justifyContent: "space-between",
    },
    historyItem: {
      padding: "14px 16px",
      background: colors.card,
      borderBottom: "1px solid " + colors.border,
      cursor: "pointer",
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
    },
    deleteBtn: {
      background: "none",
      border: "none",
      color: colors.red,
      fontSize: 18,
      cursor: "pointer",
      padding: "4px 8px",
      lineHeight: 1,
    },
  };

  if (loading) {
    return (
      <div style={{ ...s.app, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <p style={{ color: colors.textMuted }}>Chargement...</p>
      </div>
    );
  }

  // Summary stats
  const totalItems = items.length;
  const totalOpening = items.reduce((s, i) => s + i.opening, 0);
  const totalMorningSold = items.reduce((s, i) => s + i.morningUsed, 0);
  const totalAfternoonSold = items.reduce((s, i) => s + i.afternoonUsed, 0);

  return (
    <div style={s.app}>
      {/* Header */}
      <div style={s.header}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h1 style={s.title}>Journal de Stock</h1>
        </div>
        <div style={s.dateRow}>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            style={s.dateInput}
          />
          <span style={{ fontSize: 13, opacity: 0.6 }}>{formatDate(date)}</span>
        </div>
        <div style={s.tabs}>
          <button style={s.tab(view === "today")} onClick={() => setView("today")}>
            Aujourd'hui
          </button>
          <button style={s.tab(view === "history")} onClick={() => setView("history")}>
            Historique
          </button>
        </div>
      </div>

      {view === "history" ? (
        <div>
          {historyKeys.length === 0 ? (
            <p style={{ padding: 24, textAlign: "center", color: colors.textMuted }}>
              Aucun historique pour le moment.
            </p>
          ) : (
            historyKeys.map((d) => (
              <div
                key={d}
                style={s.historyItem}
                onClick={() => {
                  setDate(d);
                  setView("today");
                }}
              >
                <span style={{ fontWeight: 600 }}>{formatDate(d)}</span>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ color: colors.accent, fontSize: 13 }}>Voir →</span>
                  <button
                    style={s.deleteBtn}
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteHistoryEntry(d);
                    }}
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      ) : (
        <>
          {/* Phase bar */}
          <div style={s.phaseBar}>
            <span style={s.phaseLabel}>
              {PHASES.indexOf(phase) + 1}/3 — {PHASE_LABELS[phase]}
            </span>
            <div style={s.phaseNav}>
              <button
                style={s.phaseBtn(phase === "opening")}
                onClick={goBackPhase}
                disabled={phase === "opening"}
              >
                ←
              </button>
              <button
                style={s.phaseBtn(phase === "closing")}
                onClick={advancePhase}
                disabled={phase === "closing"}
              >
                →
              </button>
            </div>
          </div>

          {/* Summary */}
          <div style={s.summaryBar}>
            <div style={s.summaryText}>
              <span>{totalItems} articles</span>
              <span>Nombre de portions: {totalOpening}</span>
              {phase !== "opening" && <span>Vendu matin: {totalMorningSold}</span>}
              {phase === "closing" && <span>Vendu après-midi: {totalAfternoonSold}</span>}
            </div>
          </div>

          {/* Items */}
          <div style={s.section}>
            {items.map((item, i) => {
              const remainAfterMorning = item.opening - item.morningUsed;
              const remainAfterAfternoon = remainAfterMorning - item.afternoonUsed;

              return (
                <div key={i} style={s.itemCard}>
                  <div style={s.itemHeader}>
                    <span style={s.itemName}>{item.name}</span>
                    {phase === "opening" && (
                      <button style={s.removeBtn} onClick={() => removeItem(i)}>
                        ×
                      </button>
                    )}
                  </div>

                  {/* Opening stock */}
                  <div style={s.row}>
                    <span style={s.label}>Nombre de portions</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      min="0"
                      value={item.opening || ""}
                      onChange={(e) => updateItem(i, "opening", e.target.value)}
                      style={s.input(phase === "opening")}
                      placeholder="0"
                    />
                  </div>

                  {/* Morning sales */}
                  {(phase === "midday" || phase === "closing") && (
                    <div style={s.row}>
                      <span style={s.label}>Vendu matin</span>
                      <input
                        type="number"
                        inputMode="numeric"
                        min="0"
                        value={item.morningUsed || ""}
                        onChange={(e) => updateItem(i, "morningUsed", e.target.value)}
                        style={s.input(phase === "midday")}
                        placeholder="0"
                      />
                      <span style={s.remaining(remainAfterMorning)}>
                        Reste: {remainAfterMorning}
                      </span>
                    </div>
                  )}

                  {/* Afternoon sales */}
                  {phase === "closing" && (
                    <div style={s.row}>
                      <span style={s.label}>Vendu après-midi</span>
                      <input
                        type="number"
                        inputMode="numeric"
                        min="0"
                        value={item.afternoonUsed || ""}
                        onChange={(e) => updateItem(i, "afternoonUsed", e.target.value)}
                        style={s.input(phase === "closing")}
                        placeholder="0"
                      />
                      <span style={s.remaining(remainAfterAfternoon)}>
                        Reste: {remainAfterAfternoon}
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Add item */}
          <div style={s.addArea}>
            {showAddItem ? (
              <div style={s.addRow}>
                <input
                  type="text"
                  value={newItemName}
                  onChange={(e) => setNewItemName(e.target.value)}
                  placeholder="Nom de l'article..."
                  style={s.addInput}
                  onKeyDown={(e) => e.key === "Enter" && addItem()}
                  autoFocus
                />
                <button style={s.confirmBtn} onClick={addItem}>
                  Ajouter
                </button>
              </div>
            ) : (
              <button style={s.addBtn} onClick={() => setShowAddItem(true)}>
                + Ajouter un article
              </button>
            )}
          </div>

          {/* Verify actual stock */}
          {phase !== "opening" && (
            <>
              <button style={s.verifyBtn} onClick={toggleVerify}>
                {showVerify ? "Masquer la vérification" : "Vérifier le stock réel"}
              </button>

              {showVerify && (
                <div style={{ padding: "0 16px 16px" }}>
                  <p style={{ fontSize: 13, color: colors.textMuted, marginBottom: 10 }}>
                    Comptez le stock réel et saisissez les quantités. Les écarts apparaîtront
                    automatiquement.
                  </p>
                  {items.map((item, i) => {
                    const expected = getRemaining(item, phase);
                    const actual =
                      actualStock[item.name] !== undefined
                        ? actualStock[item.name]
                        : expected;
                    const diff = actual - expected;

                    return (
                      <div key={i} style={s.verifyCard(diff)}>
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                          }}
                        >
                          <div>
                            <div style={{ fontWeight: 600, fontSize: 14 }}>{item.name}</div>
                            <div style={{ fontSize: 12, color: colors.textMuted, marginTop: 2 }}>
                              Attendu: {expected}
                            </div>
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <input
                              type="number"
                              inputMode="numeric"
                              min="0"
                              value={actual}
                              onChange={(e) => updateActual(item.name, e.target.value)}
                              style={{
                                ...s.input(true),
                                width: 56,
                                background: diff === 0 ? colors.greenBg : colors.redBg,
                                borderColor: diff === 0 ? colors.green : colors.red,
                              }}
                            />
                            <span style={s.diffBadge(diff)}>
                              {diff === 0 ? "✓" : diff > 0 ? `+${diff}` : diff}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  {/* Summary of discrepancies */}
                  {(() => {
                    const discrepancies = items.filter((item) => {
                      const expected = getRemaining(item, phase);
                      const actual =
                        actualStock[item.name] !== undefined
                          ? actualStock[item.name]
                          : expected;
                      return actual !== expected;
                    });
                    if (discrepancies.length === 0) {
                      return (
                        <div
                          style={{
                            padding: 14,
                            background: colors.greenBg,
                            borderRadius: 10,
                            textAlign: "center",
                            marginTop: 8,
                            color: colors.green,
                            fontWeight: 600,
                            fontSize: 14,
                          }}
                        >
                          ✓ Tout correspond — aucun écart détecté
                        </div>
                      );
                    }
                    const totalMissing = discrepancies.reduce((sum, item) => {
                      const expected = getRemaining(item, phase);
                      const actual = actualStock[item.name] ?? expected;
                      return sum + (expected - actual);
                    }, 0);
                    return (
                      <div
                        style={{
                          padding: 14,
                          background: colors.redBg,
                          borderRadius: 10,
                          textAlign: "center",
                          marginTop: 8,
                          color: colors.red,
                          fontWeight: 600,
                          fontSize: 14,
                        }}
                      >
                        ⚠ {discrepancies.length} article(s) avec écart — {totalMissing} portion(s)
                        manquante(s)
                      </div>
                    );
                  })()}
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

