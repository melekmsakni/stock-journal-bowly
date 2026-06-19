# Stock Journal

A React-based stock inventory tracking app that logs daily sales across three phases: opening, midday, and closing.

## Features

- Track opening stock, morning sales, and afternoon sales for each item
- Real-time stock remaining calculations
- Verify actual stock counts against expected
- History view with date-based lookups
- Automatic save to localStorage
- Supabase integration for cloud history sync

## Tech Stack

- **React 18** – UI framework
- **Vite** – Build tool
- **Supabase** – Cloud history storage

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Create a `.env.local` file with your Supabase credentials:
   ```
   VITE_SUPABASE_URL=https://your-supabase-url.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-key
   ```

3. Set up the Supabase table by running the SQL in `supabase-schema.sql` in your Supabase dashboard.

4. Start the dev server:
   ```bash
   npm run dev
   ```

5. Open [http://127.0.0.1:5173](http://127.0.0.1:5173) in your browser.

## Build

```bash
npm run build
```

Outputs to `dist/`.

## Usage

- **Aujourd'hui (Today)**: Log stock and sales for today
- **Historique (History)**: View past days and switch between them
- **Verify Stock**: Compare actual count against expected for reconciliation

## License

MIT
