# Stock Journal — Claude Context

## Project overview

A French-language daily stock journal for a food retail business. Staff (father + manager) track inventory across three phases each day: opening stock → morning sales → afternoon sales. Data is shared in real-time via Supabase so both users always see the same state.

## Tech stack

- **React 18** + **Vite** (no TypeScript — plain JSX)
- **Supabase** (PostgreSQL + Row Level Security + Realtime)
- **localStorage** via `window.storage` as offline fallback
- **Playwright** (headless Chrome) for integration tests
- No component library — all styles are inline JS objects

## Key files

| File | Purpose |
|------|---------|
| `stock-journal.jsx` | Admin stock journal (~1900 lines, single component) |
| `src/App.jsx` | Auth router — checks session, fetches profile, routes to Login / StockJournal / CookApp |
| `src/login.jsx` | Login page (email + password, French UI, no self-signup) |
| `src/cook-app.jsx` | Cook counting UI — enter quantities per item, submit to `cook_counts` |
| `src/supabaseClient.js` | Creates Supabase client from env vars; returns `null` if vars missing |
| `supabase-schema.sql` | DB schema + RLS policies + Realtime publication |
| `vite.config.js` | Minimal Vite config with React plugin |

## Running the app

```bash
npm run dev        # dev server (usually http://localhost:5173 or 5174)
npm run build      # production build → dist/
```

Requires `.env` with:
```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

## Architecture decisions

### Supabase is the source of truth
`loadDay()` always tries Supabase first; localStorage is only used as an offline fallback and is kept in sync with whatever Supabase returns.

### Realtime sync
A Supabase Realtime subscription (`postgres_changes`) is created for the currently-viewed date. Any change by another user triggers `loadDayData(date)` on all connected clients.

### Race condition guard (`loadIdRef`)
Navigation between dates can produce out-of-order async loads. A monotonically-incrementing `loadIdRef` ensures a stale load that resolves after the user has already navigated away simply discards its result rather than overwriting state.

### Opening stock propagation
When a date has no saved data, `loadMostRecentItems(beforeDate)` finds the most recent *earlier* date and copies its item list, carrying forward the **remainder** from that day (`opening - morningUsed - afternoonUsed`, floored at 0) as the new opening quantity. This means the next day starts with whatever was left unsold. Future dates are explicitly excluded (`d < beforeDate`) so items can never propagate backward into history. If there is no previous day at all, the app starts with an empty list — there are no hardcoded default items.

### Timezone
Tunisia is UTC+1 year-round (no DST since 2008). `getTodayStr()` adds 1 hour to UTC before slicing the ISO string — do not change this to `toLocaleDateString` or rely on the browser locale.

```js
function getTodayStr() {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}
```

### Ajout matin / Ajout après-midi

Each item has two optional restock fields: `ajoutMatin` and `ajoutApresmidi` (both default 0).

- **Opening phase**: only `quantité de départ` is editable.
- **Midday phase**: `quantité de départ` is locked (read-only). `Ajout matin` is editable (extra stock added during morning). `Vendu matin` is editable. Reste = `départ + ajoutMatin − venduMatin`.
- **Closing phase**: `quantité de départ`, `ajout matin`, and `vendu matin` are all locked. `Ajout soir` and `Vendu soir` are editable. Final reste = `départ + ajoutMatin + ajoutApresmidi − venduMatin − venduSoir`.

`getRemaining(item, phase)` incorporates both ajout fields. `loadMostRecentItems` resets both to 0 when propagating to the next day (only the net remainder carries forward as the new opening).

### Item units
Each item has a `unit` field: `"portions"` (default), `"kg"`, or `"l"`. The unit is chosen when adding an item and can be changed later via the inline edit mode (pencil button, opening phase only). Older items without a `unit` field render as "Portions" by default. The unit label on each item card is displayed as `Quantité de départ (KG / L / Portions)` for clarity.

### Inline item editing
In the opening phase, each item card shows a pencil button (✎) next to the delete button. Clicking it opens an inline editor with a name input and unit picker. Saving updates the item in place and syncs to Supabase immediately.

### Stale localStorage guard
When `loadDay()` gets a clean null from Supabase (no error, no row — e.g. after deletion), it explicitly clears the localStorage entry for that date before returning null. This prevents deleted entries from reappearing via the offline fallback.

### Decimal portions
All item quantity inputs use `type="number" step="any" inputMode="decimal"`. State updates use `parseFloat`, not `parseInt`.

## Authentication

The app uses Supabase Auth (email + password). `src/App.jsx` checks the session on load, fetches the user's profile, and routes to the correct UI based on role.

### Roles

| Role | UI shown |
|------|----------|
| `admin` | Full stock journal + Personnel tab + cook counts panel |
| `cook` | Minimal counting screen — enter quantities per item, submit |

### Seeding the first admin

There is no self-signup. Create the first admin manually:
1. Supabase dashboard → Authentication → Users → Add user (set email + password).
2. Run in SQL editor: `insert into public.profiles (id, role, full_name, email) values ('<uuid>', 'admin', 'Name', 'email');`
3. Disable email confirmation in Supabase → Auth → Settings, otherwise cook account creation fails (no UUID until email confirmed).

### Creating cook accounts

Admin UI → Utilisateurs tab → fill in name, email, password. The app uses an isolated temporary Supabase client (`persistSession: false`) to call `signUp()` without disrupting the admin's own session, then inserts the profile row using the admin client.

### RLS recursion guard (`get_my_role()`)

A `security definer` SQL function reads `profiles` bypassing RLS and returns the caller's role. All RLS policies call `public.get_my_role()` instead of querying `profiles` directly — avoids infinite recursion. **The `profiles` table must be created before this function is defined** (order matters in the SQL migration).

### Cook access to items (`get_today_items()`)

Cooks have no direct access to `stock_history` (admin-only RLS). A `security definer` RPC `get_today_items(p_cook_id uuid default null)` reads the most recent `stock_history` row internally and returns only `(name, unit)` pairs filtered by `assigned_to`.

- When called with a cook's UUID, it returns only items where `item->>'assigned_to' = p_cook_id::text`.
- When called with `null` (or no argument), it returns all items (used for admin context if needed).
- `cook-app.jsx` calls `supabase.rpc('get_today_items', { p_cook_id: profile.id })` so each cook only sees their assigned items.

### Item assignment (`assigned_to`)

Each item in the `stock_history.items` JSONB array has an optional `assigned_to` field storing a cook's UUID (as text). This controls which items each cook sees in their counting UI.

- Admin adds/edits items in the opening phase; the "Personnel" dropdown lists all profiles with `role = 'cook'`.
- `assigned_to` is preserved when items propagate to future dates via `loadMostRecentItems`.
- Items with no `assigned_to` are only visible to admins (cooks cannot see unassigned items via the RPC filter).
- To assign items directly via SQL (e.g. for items created before the feature existed):
  ```sql
  update stock_history
  set items = (
    select jsonb_agg(item || jsonb_build_object('assigned_to', '<cook-uuid>'))
    from jsonb_array_elements(items) as item
  )
  where date = 'YYYY-MM-DD';
  ```
- The admin item card shows a `👤 {cook name}` badge when `assigned_to` is set.
- `loadCooks()` runs on component mount (not only on the Utilisateurs tab) so cook names are available for badges and dropdowns from the start.

## Database

### `public.stock_history` (admin only)

| Column | Type | Notes |
|--------|------|-------|
| `date` | date (PK) | ISO format YYYY-MM-DD |
| `items` | jsonb | Array of `{name, unit, opening, morningUsed, afternoonUsed, assigned_to?}` — `unit` is `"portions"`, `"kg"`, or `"l"`; `assigned_to` is a cook's UUID string or absent/null for unassigned |
| `phase` | text | `opening` / `midday` / `closing` |
| `actual_stock` | jsonb | Map of `{itemName: actualCount}` for closing verification |
| `updated_at` | timestamptz | Set on every upsert |

RLS: admin-only select/insert/update/delete via `get_my_role()`.
Realtime: `alter publication supabase_realtime add table public.stock_history;` must be run once.

### `public.profiles`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid (PK) | References `auth.users(id)` |
| `role` | text | `'admin'` or `'cook'` |
| `full_name` | text | Display name |
| `email` | text | Stored for convenience |
| `shift` | text | `'matin'`, `'après-midi'`, or `'journée'` — controls which cook counts phase a cook belongs to |
| `password_plain` | text | Plain-text copy stored for admin reference |
| `created_at` | timestamptz | |

RLS: each user reads own row; admins read/insert/update/delete all.

### `public.cook_counts`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid (PK) | `gen_random_uuid()` |
| `cook_id` | uuid | References `profiles(id)` |
| `date` | date | |
| `item_name` | text | |
| `unit` | text | `'portions'`, `'kg'`, or `'l'` |
| `count` | numeric | |
| `submitted_at` | timestamptz | All items in one submission share the same timestamp — used for grouping |

RLS: cooks insert/select own rows; admins select all. Index on `(date, cook_id)`.
Admin view groups submissions by `(cook_id, submitted_at)` to show one card per submission.

## Testing

Integration tests live in the session scratchpad (not committed). Run with:
```bash
node test.js
```
Tests use Playwright + headless Chrome against the running dev server. The `→` (next phase) button is disabled when there are no items — always navigate to a fresh date with no existing data for phase-navigation tests.

### Shift-based cook count filtering

Both the **Vérifier le stock réel** panel and the **Comptages des cuisiniers** panel filter submissions by shift:

- In the **midday** phase (ventes du matin): shows only `matin` + `journée` cooks.
- In the **closing** phase (ventes de l'après-midi): shows only `après-midi` + `journée` cooks.

`toggleVerify()` applies this filter when summing totals for the verification table. `toggleCookCounts()` applies the same filter when loading individual submission cards. Cooks with no `shift` value default to `'matin'`.

### Closing phase panel order

In the closing (après-midi) and midday phases the panels render in this order:
1. **Vérifier le stock réel** — comparison table (expected rest vs. cook count vs. écart)
2. **Comptages des cuisiniers** — individual submission cards per cook

## UI design

### Header
Dark gradient background (`#1A1310 → #2C2520 → #372D25`), sticky at top. Shows the app title, the formatted date as a subtitle, a date picker row (with an "Aujourd'hui" badge when on today's date), and a tab bar (Aujourd'hui / Historique / Personnel). Tabs animate with background and color transitions (`0.22s ease`). The date input has `max={getTodayStr()}` so future dates cannot be selected.

### Phase bar (stepper)
Three animated step dots sit above the phase name. The active dot expands from 6 px to 32 px wide via a `width 0.3s cubic-bezier(0.4,0,0.2,1)` transition. Done dots are faded amber, the active dot is full amber, future dots are grey. Below the dots: the phase label in bold, and "Étape X / 3" in small uppercase muted text. Navigation arrows (← →) are 38×38 rounded square buttons, amber-tinted when enabled, faded when at the edge.

### Summary bar
A scrollable row of metric tiles immediately below the phase bar. Each tile has a large bold number (fontSize 24, fontWeight 800) with a small uppercase label below. Tiles shown per phase:
- **All phases**: Articles (grey/neutral)
- **Midday + Closing**: Vdu matin (blue)
- **Closing only**: Vdu soir (purple)
The opening total is intentionally omitted — it was removed as not useful for daily operations. Tiles use `flex: "1 0 auto"` so they scroll horizontally on narrow screens.

### Vérification + Comptages accordion
In midday and closing phases, two pill buttons sit between the summary bar and the search row. Clicking "📊 Vérification" or "👨‍🍳 Comptages" expands the respective panel inline below the pills. The Vérification pill shows a live badge: green "✓ OK" or red "N écart(s)". The Comptages pill shows the submission count. This placement puts the most action-relevant panels at the top without requiring any scrolling.

### Search + Add row
A single flex row: a search input (flex: 1, with 🔍 icon and ×-clear button) and a 44×44 amber square "+" button. Clicking "+" expands an add-item form below the row as an accordion (name input, unit picker, cook assignment dropdown, Ajouter button). Clicking "×" collapses and resets the form.

### Print / PDF report

A 🖨️ button sits in the summary bar (disabled when no items). Clicking it opens a new browser window with a print-ready HTML page and triggers `window.print()` — the browser's "Save as PDF" handles the download.

Layout of the printed sheet:
- **Header**: "BOWLY" in large amber letters, date (long French format) and current time (UTC+1) below
- **Table** with a full grid (amber header row, `border-collapse: collapse`, 1px tan borders on all cells):
  1. Article — item name (pre-filled)
  2. Stock ouverture — opening quantity + unit (pre-filled)
  3. Reste cuisine matin — empty, filled by staff
  4. Reste cuisine soir — empty, filled by staff
  5. Observations — empty
  6. Signature — empty
- Alternating row shading (`#faf8f5`) for readability

The function is `printReport()`, defined just after the summary stats block. It builds the HTML string inline and writes it to a new window — no external PDF library required.

## Constraints / things to preserve

- **No TypeScript** — keep everything as plain `.jsx` / `.js`
- **Single-file component** — do not split `stock-journal.jsx` into multiple files unless explicitly asked
- **French UI** — all user-visible strings stay in French
- **History is immutable** — past days must never be modified by actions taken on a different date; `loadMostRecentItems` must keep the `d < beforeDate` filter
- **No external CSS files** — styles are inline JS objects defined in the `s` object inside the component
