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

## Authentication

The app uses Supabase Auth with two roles: **admin** and **cook**.

### Seeding the first admin user

Accounts are created by admins — there is no self-signup in the UI. To create the very first admin:

1. **Create the auth user** in the Supabase dashboard → Authentication → Users → "Invite user" (or "Add user"), then set a password.

2. **Insert the profile row** in the Supabase SQL editor:
   ```sql
   insert into public.profiles (id, role, full_name, email)
   values (
     '<paste the user UUID from the Auth Users list>',
     'admin',
     'Prénom Nom',
     'admin@example.com'
   );
   ```

3. Log in with that email + password. You will see the full admin UI.

### Creating cook accounts

Once logged in as admin, go to the **Utilisateurs** tab and fill in the form. The app creates the Supabase Auth user and the profile row automatically.

> **Important**: Disable email confirmation in Supabase → Authentication → Settings → "Enable email confirmations" (turn it off). Otherwise the cook account creation will fail because Supabase won't return a user ID until the email is confirmed.

### Roles

| Role | What they see |
|------|---------------|
| `admin` | Full stock journal + Utilisateurs tab + cook counts panel |
| `cook` | Minimal counting screen — enter quantities, submit |

## License

MIT
