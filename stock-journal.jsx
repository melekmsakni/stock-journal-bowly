import { useCallback, useEffect, useRef, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import { supabase } from './src/supabaseClient';

const PHASES = ["opening", "midday", "closing"];
const PHASE_LABELS = {
  opening: "Stock d'ouverture",
  midday: "Ventes du matin",
  closing: "Ventes de l'après-midi",
};


const HISTORY_TABLE = 'stock_history';

function getTodayStr() {
  // Tunisia is UTC+1 year-round (no DST since 2008)
  const d = new Date(Date.now() + 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

function formatDate(str) {
  const [y, m, d] = str.split("-");
  return `${d}/${m}/${y}`;
}

function formatDateLong(str) {
  const [y, m, d] = str.split('-');
  const months = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  return `${parseInt(d)} ${months[parseInt(m) - 1]} ${y}`;
}

function formatTime(isoStr) {
  const d = new Date(new Date(isoStr).getTime() + 60 * 60 * 1000);
  return d.toISOString().slice(11, 16);
}

function getLast7Days() {
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() + 60 * 60 * 1000 - i * 24 * 60 * 60 * 1000);
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

function dayLabel(dateStr) {
  const [y, m, d] = dateStr.split('-');
  const dt = new Date(Date.UTC(parseInt(y), parseInt(m) - 1, parseInt(d)));
  const names = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
  return { day: names[dt.getUTCDay()], num: parseInt(d) };
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
    // Supabase is the source of truth for shared access — always try it first
    if (supabase) {
      const { data, error } = await supabase
        .from(HISTORY_TABLE)
        .select('items, phase, actual_stock')
        .eq('date', dateStr)
        .maybeSingle();
      if (!error && data) {
        const parsed = {
          items: data.items || [],
          phase: data.phase || 'opening',
          actualStock: data.actual_stock || {},
        };
        await window.storage.set(`day:${dateStr}`, JSON.stringify(parsed));
        return parsed;
      }
      if (!error && !data) {
        // Supabase confirms no row — clear stale localStorage so it doesn't override
        try { await window.storage.remove(`day:${dateStr}`); } catch {}
        return null;
      }
    }
    // Offline fallback: localStorage
    const result = await window.storage.get(`day:${dateStr}`);
    if (result) return JSON.parse(result.value);
    return null;
  } catch {
    return null;
  }
}

async function loadMostRecentItems(beforeDate) {
  try {
    const keys = await loadAllDayKeys();
    // Only consider dates strictly before the target — never future dates
    const dates = keys
      .map((k) => k.replace("day:", ""))
      .filter((d) => d < beforeDate)
      .sort()
      .reverse();
    const prev = dates[0]; // most recent date before beforeDate
    if (prev) {
      const data = await loadDay(prev);
      if (data?.items?.length) {
        return data.items.map((item) => {
          const remainder = (item.opening || 0) - (item.morningUsed || 0) - (item.afternoonUsed || 0);
          return {
            name: item.name,
            unit: item.unit || "portions",
            opening: Math.max(0, remainder),
            morningUsed: 0,
            afternoonUsed: 0,
            assigned_to: item.assigned_to || null,
          };
        });
      }
    }
  } catch {}
  return null;
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

export default function StockJournal({ profile = null }) {
  const [view, setView] = useState("today"); // today | history | utilisateurs
  const [date, setDate] = useState(getTodayStr());
  const [items, setItems] = useState([]);
  const [phase, setPhase] = useState("opening");
  const [newItemName, setNewItemName] = useState("");
  const [newItemUnit, setNewItemUnit] = useState("portions");
  const [newItemAssignedTo, setNewItemAssignedTo] = useState([]);
  const [showNewAssignDropdown, setShowNewAssignDropdown] = useState(false);
  const [editingIndex, setEditingIndex] = useState(null);
  const [editName, setEditName] = useState("");
  const [editUnit, setEditUnit] = useState("portions");
  const [editAssignedTo, setEditAssignedTo] = useState([]);
  const [showEditAssignDropdown, setShowEditAssignDropdown] = useState(false);

  // User management (admin only)
  const [cooks, setCooks] = useState([]);
  const [showCreateCook, setShowCreateCook] = useState(false);
  const [newCookName, setNewCookName] = useState("");
  const [newCookEmail, setNewCookEmail] = useState("");
  const [newCookPassword, setNewCookPassword] = useState("");
  const [newCookShift, setNewCookShift] = useState("matin");
  const [cookFormError, setCookFormError] = useState("");
  const [cookFormLoading, setCookFormLoading] = useState(false);
  const [editingCookId, setEditingCookId] = useState(null);
  const [editCookName, setEditCookName] = useState("");
  const [editCookEmail, setEditCookEmail] = useState("");
  const [editCookShift, setEditCookShift] = useState("matin");
  const [editCookPassword, setEditCookPassword] = useState("");
  const [editCookSaving, setEditCookSaving] = useState(false);
  const [editCookError, setEditCookError] = useState("");
  const [cookAttendance, setCookAttendance] = useState({});
  const [attendanceCookId, setAttendanceCookId] = useState(null);
  const [attendanceDayDetail, setAttendanceDayDetail] = useState(null);

  // Cook counts panel (admin day view)
  const [cookCounts, setCookCounts] = useState([]);
  const [showCookCounts, setShowCookCounts] = useState(false);
  const [loading, setLoading] = useState(true);
  const [historyKeys, setHistoryKeys] = useState([]);
  const [showAddItem, setShowAddItem] = useState(false);
  const [actualStock, setActualStock] = useState({});
  const [showVerify, setShowVerify] = useState(false);
  const [verifyCookCounts, setVerifyCookCounts] = useState({});
  const [searchQuery, setSearchQuery] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);

  // Tracks the latest load so stale async results (from Realtime or fast navigation) are discarded
  const loadIdRef = useRef(0);

  // Load day data
  const loadDayData = useCallback(async (d, { silent = false } = {}) => {
    const loadId = ++loadIdRef.current;
    if (!silent) setLoading(true);
    const data = await loadDay(d);
    if (loadId !== loadIdRef.current) return; // navigated away while loading
    if (data) {
      setItems(data.items || []);
      setPhase(data.phase || "opening");
      setActualStock(data.actualStock || {});
    } else {
      const prevItems = await loadMostRecentItems(d);
      if (loadId !== loadIdRef.current) return; // navigated away while loading
      setItems(prevItems || []);
      setPhase("opening");
      setActualStock({});
    }
    if (!silent) setShowVerify(false);
    if (!silent) setLoading(false);
  }, []);

  useEffect(() => {
    loadDayData(date);
  }, [date, loadDayData]);

  // Real-time sync: reload when another user saves the same day
  useEffect(() => {
    if (!supabase) return;
    const channel = supabase
      .channel(`stock_history_${date}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: HISTORY_TABLE, filter: `date=eq.${date}` },
        () => { loadDayData(date, { silent: true }); }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
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

  // Load cooks once on mount (needed for assignment picker in today view too)
  useEffect(() => {
    loadCooks();
  }, []);

  // Close cook counts panel when navigating dates
  useEffect(() => {
    setShowCookCounts(false);
    setCookCounts([]);
  }, [date]);

  function updateItem(index, field, value) {
    const v = Math.max(0, parseFloat(value) || 0);
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
      {
        name: newItemName.trim(),
        unit: newItemUnit,
        opening: 0,
        morningUsed: 0,
        afternoonUsed: 0,
        assigned_to: newItemAssignedTo.length > 0 ? newItemAssignedTo : null,
      },
    ];
    setItems(next);
    setNewItemName("");
    setNewItemUnit("portions");
    setNewItemAssignedTo([]);
    setShowNewAssignDropdown(false);
    setShowAddItem(false);
    save(next, phase, actualStock);
  }

  function removeItem(index) {
    const next = items.filter((_, i) => i !== index);
    setItems(next);
    save(next, phase, actualStock);
  }

  function startEdit(index) {
    setEditingIndex(index);
    setEditName(items[index].name);
    setEditUnit(items[index].unit || "portions");
    const existing = items[index].assigned_to;
    setEditAssignedTo(Array.isArray(existing) ? existing : existing ? [existing] : []);
    setShowEditAssignDropdown(false);
  }

  function saveEdit() {
    if (!editName.trim()) return;
    const next = items.map((item, i) =>
      i === editingIndex
        ? { ...item, name: editName.trim(), unit: editUnit, assigned_to: editAssignedTo.length > 0 ? editAssignedTo : null }
        : item
    );
    setItems(next);
    save(next, phase, actualStock);
    setEditingIndex(null);
    setShowEditAssignDropdown(false);
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
    const v = Math.max(0, parseFloat(value) || 0);
    const next = { ...actualStock, [itemName]: v };
    setActualStock(next);
    save(items, phase, next);
  }

  async function toggleVerify() {
    if (!showVerify) {
      const { data } = await supabase
        .from('cook_counts')
        .select('item_name, count, cook_id, submitted_at')
        .eq('date', date)
        .order('submitted_at', { ascending: false });
      if (data) {
        // phase midday = ventes du matin → matin + journée cooks
        // phase closing = ventes de l'après-midi → après-midi + journée cooks
        const relevantShifts = phase === 'midday'
          ? ['matin', 'journée']
          : ['après-midi', 'journée'];

        // null/undefined shift defaults to 'matin' (created before migration)
        // If cooks haven't loaded yet, skip shift filter and include everyone
        const relevantCookIds = cooks.length > 0
          ? new Set(cooks.filter(c => relevantShifts.includes(c.shift || 'matin')).map(c => c.id))
          : null; // null = no filter

        // Most recent submission per (cook, item), sum only relevant-shift cooks
        const seen = new Set();
        const totals = {};
        data.forEach(row => {
          if (relevantCookIds && !relevantCookIds.has(row.cook_id)) return;
          const key = `${row.cook_id}:${row.item_name}`;
          if (!seen.has(key)) {
            seen.add(key);
            totals[row.item_name] = (totals[row.item_name] || 0) + Number(row.count);
          }
        });
        setVerifyCookCounts(totals);
      }
    }
    setShowVerify(prev => !prev);
  }

  async function deleteHistoryEntry(dateStr) {
    setHistoryKeys((prev) => prev.filter((d) => d !== dateStr));
    try {
      await window.storage.remove(`day:${dateStr}`);
    } catch {}
    try {
      if (supabase) {
        await supabase.from(HISTORY_TABLE).delete().eq('date', dateStr);
      }
    } catch (e) {
      console.error("Delete failed", e);
    }
  }

  async function loadCooks() {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('role', 'cook')
      .order('created_at');
    if (data) setCooks(data);
  }

  async function createCook() {
    if (!newCookName.trim() || !newCookEmail.trim() || !newCookPassword.trim()) {
      setCookFormError("Tous les champs sont requis.");
      return;
    }
    setCookFormLoading(true);
    setCookFormError("");

    // Use a separate client instance so signing up the cook does not disturb
    // the current admin session (persistSession: false keeps it isolated)
    const tempClient = createClient(
      import.meta.env.VITE_SUPABASE_URL,
      import.meta.env.VITE_SUPABASE_ANON_KEY,
      { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
    );

    let userId = null;

    const { data: signUpData, error: signUpError } = await tempClient.auth.signUp({
      email: newCookEmail.trim().toLowerCase(),
      password: newCookPassword,
    });

    if (signUpError) {
      // Auth user exists but profile was never created — recover by signing in to get the UUID
      if (signUpError.message.toLowerCase().includes('already registered')) {
        const { data: signInData, error: signInError } = await tempClient.auth.signInWithPassword({
          email: newCookEmail.trim().toLowerCase(),
          password: newCookPassword,
        });
        if (signInError || !signInData?.user?.id) {
          setCookFormError("Ce compte existe déjà avec un mot de passe différent. Supprimez-le depuis Supabase Dashboard → Authentication → Users puis réessayez.");
          setCookFormLoading(false);
          return;
        }
        userId = signInData.user.id;
      } else {
        setCookFormError("Erreur : " + signUpError.message);
        setCookFormLoading(false);
        return;
      }
    } else {
      userId = signUpData?.user?.id;
    }

    if (!userId) {
      setCookFormError(
        "Impossible de créer le compte. Désactivez la confirmation d'email dans les paramètres Supabase (Auth → Settings)."
      );
      setCookFormLoading(false);
      return;
    }

    const { error: profileError } = await supabase.from('profiles').insert({
      id: userId,
      role: 'cook',
      full_name: newCookName.trim(),
      email: newCookEmail.trim().toLowerCase(),
      shift: newCookShift,
      password_plain: newCookPassword,
    });

    if (profileError) {
      setCookFormError("Profil non créé : " + profileError.message);
      setCookFormLoading(false);
      return;
    }

    setNewCookName("");
    setNewCookEmail("");
    setNewCookPassword("");
    setNewCookShift("matin");
    setShowCreateCook(false);
    await loadCooks();
    setCookFormLoading(false);
  }

  async function deleteCook(id) {
    if (editingCookId === id) setEditingCookId(null);
    if (attendanceCookId === id) setAttendanceCookId(null);
    setCooks((prev) => prev.filter((c) => c.id !== id));
    await supabase.from('profiles').delete().eq('id', id);
  }

  function startEditCook(cook) {
    setEditingCookId(cook.id);
    setEditCookName(cook.full_name);
    setEditCookEmail(cook.email);
    setEditCookShift(cook.shift || 'matin');
    setEditCookPassword(cook.password_plain || '');
    setEditCookError('');
  }

  function cancelEditCook() {
    setEditingCookId(null);
    setEditCookError('');
  }

  async function saveCook() {
    if (!editCookName.trim()) { setEditCookError("Le nom est requis."); return; }
    setEditCookSaving(true);
    setEditCookError('');
    const { error } = await supabase.from('profiles').update({
      full_name: editCookName.trim(),
      email: editCookEmail.trim().toLowerCase(),
      shift: editCookShift,
      password_plain: editCookPassword,
    }).eq('id', editingCookId);
    if (error) {
      setEditCookError("Erreur : " + error.message);
    } else {
      await loadCooks();
      setEditingCookId(null);
    }
    setEditCookSaving(false);
  }

  async function loadAttendance() {
    const last7 = getLast7Days();
    const { data } = await supabase
      .from('cook_counts')
      .select('cook_id, date')
      .in('date', last7);
    const map = {};
    (data || []).forEach(row => {
      if (!map[row.cook_id]) map[row.cook_id] = new Set();
      map[row.cook_id].add(row.date);
    });
    setCookAttendance(map);
  }

  async function loadAttendanceDayDetail(cookId, date) {
    if (attendanceDayDetail && attendanceDayDetail.cookId === cookId && attendanceDayDetail.date === date) {
      setAttendanceDayDetail(null);
      return;
    }
    setAttendanceDayDetail({ cookId, date, loading: true, items: [], submittedAt: '' });
    const { data } = await supabase
      .from('cook_counts')
      .select('item_name, count, unit, submitted_at')
      .eq('cook_id', cookId)
      .eq('date', date)
      .order('submitted_at', { ascending: false });
    if (!data || data.length === 0) {
      setAttendanceDayDetail({ cookId, date, loading: false, items: [], submittedAt: '' });
      return;
    }
    const latestAt = data[0].submitted_at;
    const items = data
      .filter(r => r.submitted_at === latestAt)
      .map(r => ({ name: r.item_name, count: r.count, unit: r.unit }));
    setAttendanceDayDetail({ cookId, date, loading: false, items, submittedAt: latestAt });
  }

  async function toggleCookCounts() {
    if (!showCookCounts) {
      const { data } = await supabase
        .from('cook_counts')
        .select('*, profiles(full_name, shift)')
        .eq('date', date)
        .order('submitted_at', { ascending: false });
      if (data) {
        const relevantShifts = phase === 'midday'
          ? ['matin', 'journée']
          : ['après-midi', 'journée'];
        setCookCounts(data.filter(row =>
          relevantShifts.includes(row.profiles?.shift || 'matin')
        ));
      }
    }
    setShowCookCounts((prev) => !prev);
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
      background: "linear-gradient(160deg, #1A1310 0%, #2C2520 55%, #372D25 100%)",
      color: "#fff",
      padding: "18px 16px 0",
      position: "sticky",
      top: 0,
      zIndex: 10,
      boxShadow: "0 4px 24px rgba(0,0,0,0.28)",
    },
    title: {
      fontSize: 21,
      fontWeight: 800,
      margin: 0,
      letterSpacing: "-0.5px",
      display: "flex",
      alignItems: "center",
      gap: 8,
    },
    dateRow: {
      display: "flex",
      alignItems: "center",
      gap: 8,
      marginTop: 12,
      marginBottom: 14,
    },
    dateInput: {
      background: "rgba(255,255,255,0.1)",
      border: "1px solid rgba(255,255,255,0.18)",
      color: "#fff",
      padding: "7px 12px",
      borderRadius: 10,
      fontSize: 13,
      fontFamily: "inherit",
      transition: "background 0.2s, border-color 0.2s",
      cursor: "pointer",
    },
    tabs: {
      display: "flex",
      gap: 4,
      padding: "5px",
      background: "rgba(0,0,0,0.3)",
      borderRadius: "12px 12px 0 0",
    },
    tab: (active) => ({
      flex: 1,
      padding: "9px 0",
      textAlign: "center",
      fontSize: 13,
      fontWeight: active ? 700 : 500,
      color: active ? "#fff" : "rgba(255,255,255,0.5)",
      cursor: "pointer",
      background: active ? colors.accent : "none",
      border: "none",
      borderRadius: 8,
      fontFamily: "inherit",
      transition: "background 0.22s ease, color 0.22s ease, font-weight 0.1s ease",
      boxShadow: active ? "0 2px 8px rgba(196,132,29,0.45)" : "none",
      letterSpacing: active ? "-0.2px" : "0",
    }),
    phaseBar: {
      background: colors.card,
      borderBottom: "1px solid " + colors.border,
      padding: "14px 16px 12px",
    },
    phaseLabel: {
      fontSize: 16,
      fontWeight: 700,
      color: colors.text,
      textAlign: "center",
      margin: "4px 0 2px",
    },
    phaseNav: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
    },
    phaseBtn: (disabled) => ({
      width: 38, height: 38,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: 18,
      border: "1.5px solid " + (disabled ? colors.border : colors.accent + "88"),
      background: disabled ? "transparent" : colors.accentLight,
      color: disabled ? colors.border : colors.accent,
      borderRadius: 10,
      cursor: disabled ? "default" : "pointer",
      fontFamily: "inherit",
      fontWeight: 700,
      opacity: disabled ? 0.35 : 1,
      transition: "all 0.18s ease",
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
      padding: "12px 16px 4px",
      background: colors.bg,
    },
    summaryText: {
      display: "flex",
      gap: 8,
      overflowX: "auto",
      paddingBottom: 8,
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
    logoutBtn: {
      background: "rgba(255,255,255,0.08)",
      border: "1px solid rgba(255,255,255,0.15)",
      color: "rgba(255,255,255,0.7)",
      padding: "6px 12px",
      borderRadius: 8,
      fontSize: 12,
      cursor: "pointer",
      fontFamily: "inherit",
      transition: "background 0.2s, color 0.2s",
      letterSpacing: "0.02em",
    },
    userCard: {
      padding: "14px 16px",
      background: colors.card,
      borderBottom: "1px solid " + colors.border,
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
    },
    cookFormField: {
      width: "100%",
      padding: "10px 12px",
      boxSizing: "border-box",
      border: "1px solid " + colors.border,
      borderRadius: 8,
      fontSize: 14,
      fontFamily: "inherit",
      marginBottom: 10,
    },
    cookCountGroup: {
      background: colors.card,
      borderRadius: 10,
      padding: "12px 14px",
      marginBottom: 8,
      border: "1px solid " + colors.border,
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

  const filteredItems = searchQuery
    ? items.map((item, i) => ({ item, i })).filter(({ item }) =>
        item.name.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : items.map((item, i) => ({ item, i }));

  return (
    <div style={s.app}>
      {/* Header */}
      <div style={s.header}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <h1 style={s.title}>
              <span style={{ fontSize: 20 }}>📦</span>
              Journal de Stock
            </h1>
            <p style={{ margin: "4px 0 0", fontSize: 12, color: "rgba(255,255,255,0.45)", fontWeight: 400, letterSpacing: "0.01em" }}>
              {formatDateLong(date)}
            </p>
          </div>
          <button style={s.logoutBtn} onClick={() => supabase.auth.signOut()}>
            Déconnexion
          </button>
        </div>
        <div style={s.dateRow}>
          <span style={{ fontSize: 14, opacity: 0.6 }}>📅</span>
          <input
            type="date"
            value={date}
            max={getTodayStr()}
            onChange={(e) => setDate(e.target.value)}
            style={s.dateInput}
          />
          {date === getTodayStr() && (
            <span style={{
              fontSize: 11, fontWeight: 700, color: colors.accent,
              background: "rgba(196,132,29,0.18)", borderRadius: 6,
              padding: "3px 8px", letterSpacing: "0.04em", textTransform: "uppercase",
            }}>
              Aujourd'hui
            </span>
          )}
        </div>
        <div style={s.tabs}>
          <button style={s.tab(view === "today")} onClick={() => setView("today")}>
            {date === getTodayStr() ? "Aujourd'hui" : formatDate(date)}
          </button>
          <button style={s.tab(view === "history")} onClick={() => setView("history")}>
            Historique
          </button>
          <button style={s.tab(view === "utilisateurs")} onClick={() => setView("utilisateurs")}>
            Personnel
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
      ) : view === "utilisateurs" ? (
        /* ── Utilisateurs (admin user management) ── */
        <div>
          {/* Cook list */}
          {cooks.length === 0 ? (
            <p style={{ padding: 24, textAlign: "center", color: colors.textMuted }}>
              Aucun cuisinier enregistré.
            </p>
          ) : (
            cooks.map((cook) => (
              <div key={cook.id} style={{ borderBottom: "1px solid " + colors.border }}>
                {/* Cook card row */}
                <div style={{ ...s.userCard, borderBottom: "none" }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 15 }}>{cook.full_name}</div>
                    <div style={{ fontSize: 12, color: colors.textMuted, marginTop: 2 }}>
                      {cook.email}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                      <span style={{
                        fontSize: 11, fontWeight: 600, padding: '2px 8px',
                        background: colors.accentLight, color: colors.accent,
                        borderRadius: 20,
                      }}>
                        {cook.shift === 'après-midi' ? 'Après-midi' : cook.shift === 'journée' ? 'Journée' : 'Matin'}
                      </span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      title="Comptage"
                      style={{ ...s.deleteBtn, fontSize: 12, fontWeight: 700, color: attendanceCookId === cook.id ? colors.accent : colors.textMuted }}
                      onClick={() => {
                        const opening = attendanceCookId !== cook.id;
                        setAttendanceCookId(opening ? cook.id : null);
                        if (opening && Object.keys(cookAttendance).length === 0) loadAttendance();
                      }}
                    >
                      {attendanceCookId === cook.id ? '▲' : '▼'}
                    </button>
                    <button
                      style={{ ...s.deleteBtn, fontSize: 15, color: editingCookId === cook.id ? colors.accent : undefined }}
                      onClick={() => editingCookId === cook.id ? cancelEditCook() : startEditCook(cook)}
                    >
                      {editingCookId === cook.id ? '✕' : '✎'}
                    </button>
                    <button style={s.deleteBtn} onClick={() => deleteCook(cook.id)}>🗑</button>
                  </div>
                </div>

                {/* Per-cook attendance grid */}
                {attendanceCookId === cook.id && (() => {
                  const last7 = getLast7Days();
                  const today = getTodayStr();
                  const detail = attendanceDayDetail && attendanceDayDetail.cookId === cook.id ? attendanceDayDetail : null;
                  return (
                    <div style={{ background: colors.bg, borderTop: '1px solid ' + colors.border }}>
                      <div style={{ padding: '10px 16px 0' }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
                          Comptage — 7 derniers jours
                        </div>
                        <div style={{ overflowX: 'auto' }}>
                          <table style={{ borderCollapse: 'collapse', fontSize: 13, width: '100%' }}>
                            <thead>
                              <tr>
                                {last7.map(d => {
                                  const { day, num } = dayLabel(d);
                                  const isToday = d === today;
                                  return (
                                    <th key={d} style={{ textAlign: 'center', padding: '4px 6px', fontWeight: 600, color: isToday ? colors.accent : colors.textMuted, fontSize: 11, minWidth: 36 }}>
                                      <div>{day}</div>
                                      <div style={{ fontSize: 12, fontWeight: isToday ? 700 : 400 }}>{num}</div>
                                    </th>
                                  );
                                })}
                              </tr>
                            </thead>
                            <tbody>
                              <tr>
                                {last7.map(d => {
                                  const did = cookAttendance[cook.id]?.has(d);
                                  const isToday = d === today;
                                  const isSelected = detail && detail.date === d;
                                  return (
                                    <td key={d} style={{ textAlign: 'center', padding: '4px 6px' }}>
                                      {did ? (
                                        <button
                                          onClick={() => loadAttendanceDayDetail(cook.id, d)}
                                          title="Voir le détail"
                                          style={{
                                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                            width: 32, height: 32, borderRadius: '50%', fontSize: 14, fontWeight: 700,
                                            background: isSelected ? colors.green : colors.greenBg,
                                            color: isSelected ? '#fff' : colors.green,
                                            border: isSelected ? '2px solid ' + colors.green : '2px solid transparent',
                                            cursor: 'pointer', transition: 'all 0.15s',
                                          }}
                                        >
                                          ✓
                                        </button>
                                      ) : (
                                        <span style={{
                                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                          width: 32, height: 32, borderRadius: '50%', fontSize: 14, fontWeight: 700,
                                          background: isToday ? colors.accentLight : colors.card,
                                          color: colors.border,
                                          border: '2px solid ' + colors.border,
                                        }}>
                                          ✗
                                        </span>
                                      )}
                                    </td>
                                  );
                                })}
                              </tr>
                            </tbody>
                          </table>
                        </div>
                      </div>

                      {/* Day detail panel */}
                      {detail && (
                        <div style={{
                          margin: '10px 16px 14px',
                          background: colors.card,
                          border: '1px solid ' + colors.green + '44',
                          borderRadius: 10,
                          overflow: 'hidden',
                        }}>
                          <div style={{
                            padding: '8px 12px',
                            background: colors.greenBg,
                            borderBottom: '1px solid ' + colors.green + '33',
                            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                          }}>
                            <span style={{ fontWeight: 700, fontSize: 13, color: colors.green }}>
                              {formatDateLong(detail.date)}
                            </span>
                            {detail.loading ? (
                              <span style={{ fontSize: 12, color: colors.textMuted }}>Chargement...</span>
                            ) : detail.submittedAt ? (
                              <span style={{ fontSize: 12, color: colors.textMuted }}>
                                soumis à {formatTime(detail.submittedAt)}
                              </span>
                            ) : null}
                          </div>
                          {!detail.loading && detail.items.length > 0 && detail.items.map((item, i) => (
                            <div key={item.name} style={{
                              padding: '8px 12px',
                              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                              borderBottom: i < detail.items.length - 1 ? '1px solid ' + colors.border + '88' : 'none',
                            }}>
                              <span style={{ fontSize: 13, color: colors.text }}>{item.name}</span>
                              <span style={{ fontSize: 13, fontWeight: 700, color: colors.accent }}>
                                {item.count}
                                <span style={{ fontSize: 11, fontWeight: 400, color: colors.textMuted, marginLeft: 4 }}>
                                  {item.unit === 'kg' ? 'KG' : item.unit === 'l' ? 'L' : 'Portions'}
                                </span>
                              </span>
                            </div>
                          ))}
                          {!detail.loading && detail.items.length === 0 && (
                            <div style={{ padding: '10px 12px', fontSize: 13, color: colors.textMuted, textAlign: 'center' }}>
                              Aucune donnée trouvée.
                            </div>
                          )}
                        </div>
                      )}

                      {!detail && <div style={{ height: 14 }} />}
                    </div>
                  );
                })()}

                {/* Inline edit form */}
                {editingCookId === cook.id && (
                  <div style={{ padding: '0 16px 16px', background: colors.bg, borderTop: '1px solid ' + colors.border }}>
                    <div style={{ paddingTop: 12 }}>
                      <input
                        type="text"
                        placeholder="Nom complet"
                        value={editCookName}
                        onChange={(e) => setEditCookName(e.target.value)}
                        style={s.cookFormField}
                      />
                      <input
                        type="email"
                        placeholder="Email"
                        value={editCookEmail}
                        onChange={(e) => setEditCookEmail(e.target.value)}
                        style={s.cookFormField}
                      />
                      <select
                        value={editCookShift}
                        onChange={(e) => setEditCookShift(e.target.value)}
                        style={{ ...s.cookFormField, cursor: 'pointer' }}
                      >
                        <option value="matin">Matin</option>
                        <option value="après-midi">Après-midi</option>
                        <option value="journée">Journée complète</option>
                      </select>
                      <div style={{ position: 'relative' }}>
                        <input
                          type="text"
                          placeholder="Mot de passe"
                          value={editCookPassword}
                          onChange={(e) => setEditCookPassword(e.target.value)}
                          style={{ ...s.cookFormField, fontFamily: 'monospace', letterSpacing: 1 }}
                        />
                      </div>
                      {editCookError && (
                        <div style={{ background: colors.redBg, color: colors.red, borderRadius: 8, padding: "8px 12px", fontSize: 13, marginBottom: 10 }}>
                          {editCookError}
                        </div>
                      )}
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          style={{ ...s.confirmBtn, flex: 1, opacity: editCookSaving ? 0.6 : 1 }}
                          onClick={saveCook}
                          disabled={editCookSaving}
                        >
                          {editCookSaving ? 'Enregistrement...' : 'Enregistrer'}
                        </button>
                        <button
                          style={{ padding: "10px 14px", border: "1px solid " + colors.border, borderRadius: 8, background: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 14 }}
                          onClick={cancelEditCook}
                        >
                          Annuler
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))
          )}

          {/* Create cook form */}
          <div style={{ padding: "16px 16px" }}>
            {showCreateCook ? (
              <div style={{
                background: colors.card,
                border: "1px solid " + colors.border,
                borderRadius: 12,
                padding: 16,
              }}>
                <div style={{ fontWeight: 600, marginBottom: 12, fontSize: 14 }}>
                  Nouveau cuisinier
                </div>
                <input
                  type="text"
                  placeholder="Nom complet"
                  value={newCookName}
                  onChange={(e) => setNewCookName(e.target.value)}
                  style={s.cookFormField}
                />
                <input
                  type="email"
                  placeholder="Email"
                  value={newCookEmail}
                  onChange={(e) => setNewCookEmail(e.target.value)}
                  style={s.cookFormField}
                />
                <input
                  type="password"
                  placeholder="Mot de passe temporaire"
                  value={newCookPassword}
                  onChange={(e) => setNewCookPassword(e.target.value)}
                  style={s.cookFormField}
                />
                <select
                  value={newCookShift}
                  onChange={(e) => setNewCookShift(e.target.value)}
                  style={{ ...s.cookFormField, cursor: 'pointer' }}
                >
                  <option value="matin">Matin</option>
                  <option value="après-midi">Après-midi</option>
                  <option value="journée">Journée complète</option>
                </select>
                {cookFormError && (
                  <div style={{
                    background: colors.redBg, color: colors.red,
                    borderRadius: 8, padding: "8px 12px", fontSize: 13, marginBottom: 10,
                  }}>
                    {cookFormError}
                  </div>
                )}
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    style={{ ...s.confirmBtn, flex: 1, opacity: cookFormLoading ? 0.6 : 1 }}
                    onClick={createCook}
                    disabled={cookFormLoading}
                  >
                    {cookFormLoading ? "Création..." : "Créer le compte"}
                  </button>
                  <button
                    style={{
                      padding: "10px 16px", border: "1px solid " + colors.border,
                      borderRadius: 8, background: "none", cursor: "pointer",
                      fontFamily: "inherit", fontSize: 14,
                    }}
                    onClick={() => { setShowCreateCook(false); setCookFormError(""); }}
                  >
                    Annuler
                  </button>
                </div>
              </div>
            ) : (
              <button style={s.addBtn} onClick={() => setShowCreateCook(true)}>
                + Ajouter un cuisinier
              </button>
            )}
          </div>
        </div>
      ) : (
        <>
          {/* Phase bar — stepper */}
          <div style={s.phaseBar}>
            <div style={s.phaseNav}>
              <button style={s.phaseBtn(phase === "opening")} onClick={goBackPhase} disabled={phase === "opening"}>←</button>

              <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
                {/* Step dots */}
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  {PHASES.map((p, idx) => {
                    const currentIdx = PHASES.indexOf(phase);
                    const done = idx < currentIdx;
                    const active = idx === currentIdx;
                    return (
                      <div key={p} style={{
                        height: 6,
                        width: active ? 32 : 6,
                        borderRadius: 3,
                        background: done ? colors.accent + "55" : active ? colors.accent : colors.border,
                        transition: "width 0.3s cubic-bezier(0.4,0,0.2,1), background 0.3s ease",
                      }} />
                    );
                  })}
                </div>
                {/* Phase name */}
                <div>
                  <div style={s.phaseLabel}>{PHASE_LABELS[phase]}</div>
                  <div style={{ fontSize: 11, color: colors.textMuted, textAlign: "center", textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 600 }}>
                    Étape {PHASES.indexOf(phase) + 1} / 3
                  </div>
                </div>
              </div>

              <button style={s.phaseBtn(phase === "closing")} onClick={advancePhase} disabled={phase === "closing"}>→</button>
            </div>
          </div>

          {/* Summary metric tiles */}
          <div style={s.summaryBar}>
            <div style={s.summaryText}>
              {[
                { label: "Articles", value: totalItems, color: colors.textMuted, bg: colors.card, border: colors.border },
                ...(phase !== "opening" ? [{ label: "Vdu matin", value: totalMorningSold, color: colors.blue, bg: colors.blueBg, border: colors.blue + "44" }] : []),
                ...(phase === "closing" ? [{ label: "Vdu soir", value: totalAfternoonSold, color: "#7B1FA2", bg: "#F3E5F5", border: "#CE93D844" }] : []),
              ].map(({ label, value, color, bg, border }) => (
                <div key={label} style={{
                  flex: "1 0 auto",
                  background: bg,
                  border: "1.5px solid " + border,
                  borderRadius: 14,
                  padding: "10px 12px 8px",
                  textAlign: "center",
                  minWidth: 72,
                }}>
                  <div style={{ fontSize: 24, fontWeight: 800, color, lineHeight: 1, letterSpacing: "-0.5px" }}>{value}</div>
                  <div style={{ fontSize: 10, color, fontWeight: 700, marginTop: 4, textTransform: "uppercase", letterSpacing: "0.06em", opacity: 0.75 }}>{label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Verify + Cook counts — top accordion pills for midday/closing */}
          {phase !== "opening" && (
            <div style={{ padding: "8px 16px 4px" }}>
              {/* Pill button row */}
              <div style={{ display: "flex", gap: 8, marginBottom: (showVerify || showCookCounts) ? 10 : 0 }}>
                <button
                  onClick={toggleVerify}
                  style={{
                    flex: 1, padding: "10px 12px", borderRadius: 12,
                    border: "1.5px solid " + (showVerify ? colors.accent : colors.border),
                    background: showVerify ? colors.accentLight : colors.card,
                    color: showVerify ? colors.accent : colors.text,
                    fontWeight: 600, fontSize: 13, cursor: "pointer", fontFamily: "inherit",
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                    transition: "all 0.15s",
                    boxShadow: showVerify ? "0 2px 8px " + colors.accent + "22" : "0 1px 3px rgba(0,0,0,0.06)",
                  }}
                >
                  <span style={{ fontSize: 15 }}>📊</span>
                  <span>Vérification</span>
                  {(() => {
                    const counted = items.filter(item => verifyCookCounts[item.name] !== undefined);
                    if (counted.length === 0) return null;
                    const discrepancies = counted.filter(item => verifyCookCounts[item.name] !== getRemaining(item, phase));
                    return (
                      <span style={{
                        background: discrepancies.length > 0 ? colors.red : colors.green,
                        color: "#fff", borderRadius: 99, fontSize: 11, fontWeight: 700,
                        padding: "1px 7px", lineHeight: "18px",
                      }}>
                        {discrepancies.length > 0 ? `${discrepancies.length} écart${discrepancies.length > 1 ? "s" : ""}` : "✓ OK"}
                      </span>
                    );
                  })()}
                </button>

                <button
                  onClick={toggleCookCounts}
                  style={{
                    flex: 1, padding: "10px 12px", borderRadius: 12,
                    border: "1.5px solid " + (showCookCounts ? colors.blue : colors.border),
                    background: showCookCounts ? colors.blueBg : colors.card,
                    color: showCookCounts ? colors.blue : colors.text,
                    fontWeight: 600, fontSize: 13, cursor: "pointer", fontFamily: "inherit",
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                    transition: "all 0.15s",
                    boxShadow: showCookCounts ? "0 2px 8px " + colors.blue + "22" : "0 1px 3px rgba(0,0,0,0.06)",
                  }}
                >
                  <span style={{ fontSize: 15 }}>👨‍🍳</span>
                  <span>Comptages</span>
                  {cookCounts.length > 0 && (
                    <span style={{
                      background: colors.blue, color: "#fff",
                      borderRadius: 99, fontSize: 11, fontWeight: 700,
                      padding: "1px 7px", lineHeight: "18px",
                    }}>
                      {cookCounts.length}
                    </span>
                  )}
                </button>
              </div>

              {/* Verify panel */}
              {showVerify && (
                <div style={{
                  background: colors.card, borderRadius: 14,
                  border: "1.5px solid " + colors.accent + "33",
                  marginBottom: 8, overflow: "hidden",
                }}>
                  <div style={{ padding: "12px 14px 8px" }}>
                    <p style={{ fontSize: 12, color: colors.textMuted, margin: "0 0 10px" }}>
                      Comptage des cuisiniers du {phase === "midday" ? "matin" : "soir"} vs stock attendu.
                    </p>
                    <div style={{ display: "flex", justifyContent: "space-between", padding: "0 2px 6px", fontSize: 11, fontWeight: 600, color: colors.textMuted, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                      <span>Article</span>
                      <div style={{ display: "flex", gap: 16, textAlign: "right" }}>
                        <span style={{ width: 56 }}>Reste prévu</span>
                        <span style={{ width: 56 }}>En cuisine</span>
                        <span style={{ width: 40 }}>Écart</span>
                      </div>
                    </div>
                    {items.map((item, i) => {
                      const expected = getRemaining(item, phase);
                      const hasCookCount = verifyCookCounts[item.name] !== undefined;
                      const cookCount = hasCookCount ? verifyCookCounts[item.name] : null;
                      const diff = hasCookCount ? cookCount - expected : null;
                      const matches = diff === 0;
                      return (
                        <div key={i} style={{
                          ...s.verifyCard(hasCookCount ? diff : 0),
                          background: !hasCookCount ? colors.bgPage : matches ? colors.greenBg : colors.redBg,
                          border: "1px solid " + (!hasCookCount ? colors.border : matches ? colors.green + "33" : colors.red + "33"),
                          marginBottom: 6,
                        }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <div style={{ fontWeight: 600, fontSize: 14 }}>{item.name}</div>
                            <div style={{ display: "flex", gap: 16, alignItems: "center", textAlign: "right" }}>
                              <span style={{ width: 56, fontSize: 15, fontWeight: 700, color: colors.text }}>{expected}</span>
                              <span style={{ width: 56, fontSize: 15, fontWeight: 700, color: hasCookCount ? colors.text : colors.textMuted }}>
                                {hasCookCount ? cookCount : "—"}
                              </span>
                              <span style={{ width: 40, ...s.diffBadge(diff ?? 0), color: !hasCookCount ? colors.textMuted : matches ? colors.green : colors.red }}>
                                {!hasCookCount ? "—" : matches ? "✓" : diff > 0 ? `+${diff}` : diff}
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    {(() => {
                      const counted = items.filter(item => verifyCookCounts[item.name] !== undefined);
                      if (counted.length === 0) {
                        return (
                          <div style={{ padding: "10px 14px", background: colors.accentLight, borderRadius: 10, textAlign: "center", marginTop: 4, color: colors.accent, fontWeight: 600, fontSize: 13 }}>
                            Aucun comptage soumis par les cuisiniers pour ce jour
                          </div>
                        );
                      }
                      const discrepancies = counted.filter(item => verifyCookCounts[item.name] !== getRemaining(item, phase));
                      if (discrepancies.length === 0) {
                        return (
                          <div style={{ padding: "10px 14px", background: colors.greenBg, borderRadius: 10, textAlign: "center", marginTop: 4, color: colors.green, fontWeight: 600, fontSize: 13 }}>
                            ✓ Tout correspond — aucun écart détecté
                          </div>
                        );
                      }
                      const totalDiff = discrepancies.reduce((sum, item) => {
                        return sum + Math.abs(verifyCookCounts[item.name] - getRemaining(item, phase));
                      }, 0);
                      return (
                        <div style={{ padding: "10px 14px", background: colors.redBg, borderRadius: 10, textAlign: "center", marginTop: 4, color: colors.red, fontWeight: 600, fontSize: 13 }}>
                          ⚠ {discrepancies.length} article(s) avec écart — {totalDiff} unité(s) de différence
                        </div>
                      );
                    })()}
                  </div>
                </div>
              )}

              {/* Cook counts panel */}
              {showCookCounts && (
                <div style={{
                  background: colors.card, borderRadius: 14,
                  border: "1.5px solid " + colors.blue + "33",
                  marginBottom: 8, overflow: "hidden",
                }}>
                  <div style={{ padding: "12px 14px 8px" }}>
                    {cookCounts.length === 0 ? (
                      <p style={{ textAlign: "center", color: colors.textMuted, padding: "8px 0", fontSize: 13, margin: 0 }}>
                        Aucun comptage pour ce jour.
                      </p>
                    ) : (() => {
                      const groups = [];
                      const seen = new Map();
                      cookCounts.forEach((row) => {
                        const key = `${row.cook_id}_${row.submitted_at}`;
                        if (!seen.has(key)) {
                          const g = {
                            key,
                            full_name: row.profiles?.full_name || "Inconnu",
                            submitted_at: row.submitted_at,
                            items: [],
                          };
                          seen.set(key, g);
                          groups.push(g);
                        }
                        seen.get(key).items.push(row);
                      });
                      return groups.map((g) => (
                        <div key={g.key} style={{ ...s.cookCountGroup, marginBottom: 8 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
                            <span style={{ fontWeight: 600, fontSize: 14 }}>{g.full_name}</span>
                            <span style={{ fontSize: 12, color: colors.textMuted }}>
                              {new Date(new Date(g.submitted_at).getTime() + 60 * 60 * 1000)
                                .toISOString().slice(11, 16)}
                            </span>
                          </div>
                          {g.items.map((row) => (
                            <div key={row.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, paddingTop: 4, color: colors.text }}>
                              <span>{row.item_name}</span>
                              <span style={{ fontWeight: 600 }}>
                                {row.count} {row.unit === "kg" ? "KG" : row.unit === "l" ? "L" : "port."}
                              </span>
                            </div>
                          ))}
                        </div>
                      ));
                    })()}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Search + Add — single unified row */}
          <div style={{ padding: "10px 16px 6px", position: "relative" }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              {/* Search input */}
              <div style={{ position: "relative", flex: 1 }}>
                <span style={{
                  position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)",
                  color: colors.textMuted, fontSize: 15, pointerEvents: "none", userSelect: "none",
                }}>🔍</span>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => { setSearchQuery(e.target.value); setShowSuggestions(true); }}
                  onFocus={() => setShowSuggestions(true)}
                  onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                  placeholder="Rechercher un article..."
                  style={{
                    width: "100%",
                    boxSizing: "border-box",
                    padding: "11px 36px 11px 38px",
                    border: "1.5px solid " + (searchQuery ? colors.accent : colors.border),
                    borderRadius: 12,
                    fontSize: 14,
                    fontFamily: "inherit",
                    background: "#fff",
                    outline: "none",
                    transition: "border-color 0.15s",
                    boxShadow: "0 1px 4px rgba(0,0,0,0.05)",
                  }}
                />
                {searchQuery && (
                  <button
                    onClick={() => { setSearchQuery(""); setShowSuggestions(false); }}
                    style={{
                      position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)",
                      background: "none", border: "none", cursor: "pointer",
                      fontSize: 18, color: colors.textMuted, padding: "0 4px", lineHeight: 1, fontFamily: "inherit",
                    }}
                  >×</button>
                )}
              </div>
              {/* Add button — compact square pill */}
              <button
                onClick={() => {
                  if (showAddItem) { setShowAddItem(false); setNewItemName(""); setNewItemUnit("portions"); setNewItemAssignedTo([]); setShowNewAssignDropdown(false); }
                  else setShowAddItem(true);
                }}
                title={showAddItem ? "Fermer" : "Ajouter un article"}
                style={{
                  width: 44, height: 44, flexShrink: 0, borderRadius: 12,
                  border: "1.5px solid " + (showAddItem ? colors.accent : colors.accent + "66"),
                  background: showAddItem ? colors.accent : colors.accentLight,
                  color: showAddItem ? "#fff" : colors.accent,
                  fontSize: showAddItem ? 22 : 24, fontWeight: 700,
                  cursor: "pointer", fontFamily: "inherit",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  transition: "all 0.15s",
                  boxShadow: showAddItem ? "0 2px 10px " + colors.accent + "44" : "0 1px 3px rgba(0,0,0,0.06)",
                  lineHeight: 1,
                }}
              >
                {showAddItem ? "×" : "+"}
              </button>
            </div>

            {/* Suggestions dropdown */}
            {showSuggestions && searchQuery && (() => {
              const q = searchQuery.toLowerCase();
              const suggestions = items.filter(item =>
                item.name.toLowerCase().includes(q) && item.name.toLowerCase() !== q
              );
              if (suggestions.length === 0) return null;
              return (
                <div style={{
                  position: "absolute", left: 16, right: 16, zIndex: 30,
                  background: "#fff",
                  border: "1.5px solid " + colors.accent,
                  borderTop: "none",
                  borderRadius: "0 0 12px 12px",
                  boxShadow: "0 6px 20px rgba(0,0,0,0.12)",
                  overflow: "hidden",
                }}>
                  {suggestions.slice(0, 6).map((suggestion, idx) => (
                    <div
                      key={suggestion.name}
                      onMouseDown={() => { setSearchQuery(suggestion.name); setShowSuggestions(false); }}
                      style={{
                        padding: "10px 14px", fontSize: 14, cursor: "pointer",
                        display: "flex", alignItems: "center", gap: 10,
                        borderTop: idx > 0 ? "1px solid " + colors.border : "none",
                        color: colors.text, background: "#fff",
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = colors.accentLight; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = "#fff"; }}
                    >
                      <span style={{ color: colors.accent, fontSize: 13 }}>↩</span>
                      <span>{suggestion.name}</span>
                    </div>
                  ))}
                </div>
              );
            })()}

            {/* Add item form — accordion below the row */}
            {showAddItem && (
              <div style={{
                marginTop: 8,
                background: colors.card,
                border: "1.5px solid " + colors.accent + "55",
                borderRadius: 12,
                padding: 12,
                display: "flex", flexDirection: "column", gap: 8,
                boxShadow: "0 2px 12px rgba(196,132,29,0.08)",
              }}>
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
                <div style={{ display: "flex", gap: 6 }}>
                  {[
                    { value: "portions", label: "Portions" },
                    { value: "kg", label: "KG" },
                    { value: "l", label: "L" },
                  ].map(({ value, label }) => (
                    <button
                      key={value}
                      onClick={() => setNewItemUnit(value)}
                      style={{
                        flex: 1,
                        padding: "8px 0",
                        border: "1px solid " + (newItemUnit === value ? colors.accent : colors.border),
                        borderRadius: 8,
                        background: newItemUnit === value ? colors.accentLight : "#fff",
                        color: newItemUnit === value ? colors.accent : colors.textMuted,
                        fontWeight: newItemUnit === value ? 700 : 400,
                        fontSize: 14,
                        cursor: "pointer",
                        fontFamily: "inherit",
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {cooks.length > 0 && (
                  <div style={{ position: 'relative' }}>
                    <div style={{ fontSize: 11, color: colors.textMuted, fontWeight: 600, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Personnel assigné</div>
                    <button
                      type="button"
                      onClick={() => setShowNewAssignDropdown(prev => !prev)}
                      style={{
                        width: '100%', padding: '8px 12px', background: '#fff',
                        border: '1px solid ' + (showNewAssignDropdown ? colors.accent : colors.border),
                        borderRadius: showNewAssignDropdown ? '8px 8px 0 0' : 8,
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, color: colors.text,
                      }}
                    >
                      <span style={{ color: newItemAssignedTo.length === 0 ? colors.textMuted : colors.text }}>
                        {newItemAssignedTo.length === 0
                          ? 'Aucun'
                          : newItemAssignedTo.map(id => cooks.find(c => c.id === id)?.full_name).filter(Boolean).join(', ')}
                      </span>
                      <span style={{ fontSize: 11, color: colors.textMuted }}>{showNewAssignDropdown ? '▲' : '▼'}</span>
                    </button>
                    {showNewAssignDropdown && (
                      <div style={{
                        position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10,
                        background: '#fff', border: '1px solid ' + colors.accent,
                        borderTop: 'none', borderRadius: '0 0 8px 8px',
                        boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                      }}>
                        {cooks.map((c, ci) => {
                          const selected = newItemAssignedTo.includes(c.id);
                          return (
                            <div
                              key={c.id}
                              onClick={() => setNewItemAssignedTo(prev => selected ? prev.filter(id => id !== c.id) : [...prev, c.id])}
                              style={{
                                padding: '9px 12px', cursor: 'pointer', fontSize: 13,
                                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                background: selected ? colors.accentLight : '#fff',
                                borderTop: ci > 0 ? '1px solid ' + colors.border : 'none',
                              }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span style={{
                                  width: 18, height: 18, borderRadius: 4, border: '2px solid ' + (selected ? colors.accent : colors.border),
                                  background: selected ? colors.accent : '#fff',
                                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                  flexShrink: 0,
                                }}>
                                  {selected && <span style={{ color: '#fff', fontSize: 11, lineHeight: 1 }}>✓</span>}
                                </span>
                                <span style={{ fontWeight: selected ? 600 : 400 }}>{c.full_name}</span>
                              </div>
                              <span style={{ fontSize: 11, color: colors.accent, fontWeight: 600 }}>
                                {c.shift === 'après-midi' ? 'AM' : c.shift === 'journée' ? 'Jour.' : 'Mat.'}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Items */}
          <div style={s.section}>
            {filteredItems.length === 0 && searchQuery ? (
              <div style={{
                textAlign: "center",
                padding: "24px 16px",
                color: colors.textMuted,
                fontSize: 14,
              }}>
                Aucun article trouvé pour « {searchQuery} »
              </div>
            ) : filteredItems.map(({ item, i }) => {
              const remainAfterMorning = item.opening - item.morningUsed;
              const remainAfterAfternoon = remainAfterMorning - item.afternoonUsed;

              return (
                <div key={i} style={s.itemCard}>
                  <div style={s.itemHeader}>
                    {editingIndex === i ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: 6, width: "100%" }}>
                        <div style={{ display: "flex", gap: 6 }}>
                          <input
                            type="text"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && saveEdit()}
                            style={{ ...s.addInput, flex: 1, fontSize: 14, padding: "6px 10px" }}
                            autoFocus
                          />
                          <button style={s.confirmBtn} onClick={saveEdit}>✓</button>
                          <button
                            style={{ ...s.removeBtn, fontSize: 14, padding: "4px 8px" }}
                            onClick={() => setEditingIndex(null)}
                          >✕</button>
                        </div>
                        <div style={{ display: "flex", gap: 6 }}>
                          {[
                            { value: "portions", label: "Portions" },
                            { value: "kg", label: "KG" },
                            { value: "l", label: "L" },
                          ].map(({ value, label }) => (
                            <button
                              key={value}
                              onClick={() => setEditUnit(value)}
                              style={{
                                flex: 1,
                                padding: "6px 0",
                                border: "1px solid " + (editUnit === value ? colors.accent : colors.border),
                                borderRadius: 8,
                                background: editUnit === value ? colors.accentLight : "#fff",
                                color: editUnit === value ? colors.accent : colors.textMuted,
                                fontWeight: editUnit === value ? 700 : 400,
                                fontSize: 13,
                                cursor: "pointer",
                                fontFamily: "inherit",
                              }}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                        {cooks.length > 0 && (
                          <div style={{ position: 'relative' }}>
                            <div style={{ fontSize: 11, color: colors.textMuted, fontWeight: 600, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Personnel assigné</div>
                            <button
                              type="button"
                              onClick={() => setShowEditAssignDropdown(prev => !prev)}
                              style={{
                                width: '100%', padding: '8px 12px', background: '#fff',
                                border: '1px solid ' + (showEditAssignDropdown ? colors.accent : colors.border),
                                borderRadius: showEditAssignDropdown ? '8px 8px 0 0' : 8,
                                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, color: colors.text,
                              }}
                            >
                              <span style={{ color: editAssignedTo.length === 0 ? colors.textMuted : colors.text }}>
                                {editAssignedTo.length === 0
                                  ? 'Aucun'
                                  : editAssignedTo.map(id => cooks.find(c => c.id === id)?.full_name).filter(Boolean).join(', ')}
                              </span>
                              <span style={{ fontSize: 11, color: colors.textMuted }}>{showEditAssignDropdown ? '▲' : '▼'}</span>
                            </button>
                            {showEditAssignDropdown && (
                              <div style={{
                                position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10,
                                background: '#fff', border: '1px solid ' + colors.accent,
                                borderTop: 'none', borderRadius: '0 0 8px 8px',
                                boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                              }}>
                                {cooks.map((c, ci) => {
                                  const selected = editAssignedTo.includes(c.id);
                                  return (
                                    <div
                                      key={c.id}
                                      onClick={() => setEditAssignedTo(prev => selected ? prev.filter(id => id !== c.id) : [...prev, c.id])}
                                      style={{
                                        padding: '9px 12px', cursor: 'pointer', fontSize: 13,
                                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                        background: selected ? colors.accentLight : '#fff',
                                        borderTop: ci > 0 ? '1px solid ' + colors.border : 'none',
                                      }}
                                    >
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                        <span style={{
                                          width: 18, height: 18, borderRadius: 4, border: '2px solid ' + (selected ? colors.accent : colors.border),
                                          background: selected ? colors.accent : '#fff',
                                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                          flexShrink: 0,
                                        }}>
                                          {selected && <span style={{ color: '#fff', fontSize: 11, lineHeight: 1 }}>✓</span>}
                                        </span>
                                        <span style={{ fontWeight: selected ? 600 : 400 }}>{c.full_name}</span>
                                      </div>
                                      <span style={{ fontSize: 11, color: colors.accent, fontWeight: 600 }}>
                                        {c.shift === 'après-midi' ? 'AM' : c.shift === 'journée' ? 'Jour.' : 'Mat.'}
                                      </span>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ) : (
                      <>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <span style={s.itemName}>{item.name}</span>
                          {item.assigned_to && (() => {
                            const ids = Array.isArray(item.assigned_to) ? item.assigned_to : [item.assigned_to];
                            const names = ids.map(id => cooks.find(c => c.id === id)?.full_name).filter(Boolean);
                            return names.length > 0 ? (
                              <div style={{ fontSize: 11, color: colors.accent, marginTop: 2, fontWeight: 600 }}>
                                👤 {names.join(', ')}
                              </div>
                            ) : null;
                          })()}
                        </div>
                        {phase === "opening" && (
                          <div style={{ display: "flex", gap: 4 }}>
                            <button style={{ ...s.removeBtn, fontSize: 15 }} onClick={() => startEdit(i)}>
                              ✎
                            </button>
                            <button style={s.removeBtn} onClick={() => removeItem(i)}>
                              ×
                            </button>
                          </div>
                        )}
                      </>
                    )}
                  </div>

                  {/* Opening stock */}
                  <div style={s.row}>
                    <span style={s.label}>
                      {`Quantité de départ (${item.unit === "kg" ? "KG" : item.unit === "l" ? "L" : "Portions"})`}
                    </span>
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="any"
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
                        inputMode="decimal"
                        min="0"
                        step="any"
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
                        inputMode="decimal"
                        min="0"
                        step="any"
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


        </>
      )}
    </div>
  );
}

