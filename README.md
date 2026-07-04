# DistroIQ Sales, Stock & Distribution Platform

DistroIQ is a role-based sales, stock, and distribution platform for a confectionery factory producing chips and other snack products. It replaces the notebook, phone call, and end-of-month reconciliation meeting with one connected workspace.

The platform tracks what stock exists and what happens to it: raw materials, packaging, finished snacks, rep stock assignments, customer sales, returns, and balances owed. Managers and store keepers control product, stock, and credit configuration, while sales representatives capture field activity.

The app is split by responsibility so future screens and workflows are easier to find, test, and extend.

The frontend files are local to this computer. Supabase is used for authentication, tenant records, role-scoped accounts, invites, and row-level security once configured.

## Role Permissions

| Role | Access model |
| --- | --- |
| Sales Rep | Sees their own assigned stock and sales work, logs sales/returns, views own credit balance, and submits reports. |
| Manager | Manages products, assigns stock to reps, reconciles stock, sets credit limits, manages supermarkets/customers, and reviews reports. |
| Store Keeper | Manages raw materials, finished goods, equipment, stock movements, and stock dispatch. |
| Accountant | Read-only sales reports, credit balances, revenue/profit summaries, and exports. |
| CEO | Read-only company-wide dashboard across sales, stock, reps, supermarkets/customers, and reports. |
| Super Admin | Full platform control: creates factories/companies, manages users, resets access, configures modules, and audits records. |

## Run

```bash
npm run dev
```

The server prints the local URL. By default it starts at `http://127.0.0.1:8080` and moves to the next free port if needed.

## Supabase Setup

1. Create a Supabase project.
2. Open `src/js/config/supabase.js` and set:
   - `url`
   - `anonKey`
3. Run `supabase/schema.sql` in the Supabase SQL Editor.
4. Deploy the invite Edge Function:

```bash
supabase functions deploy invite-user
```

The Edge Function uses Supabase environment variables already available in deployed functions: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`.

## Structure

```text
.
|-- index.html
|-- package.json
|-- scripts/
|   `-- dev-server.mjs
|-- supabase/
|   |-- schema.sql
|   `-- functions/
|       `-- invite-user/
|           `-- index.ts
|-- src/
|   |-- assets/
|   |   `-- distro-iq-mark.svg
|   |-- css/
|   |   |-- app.css
|   |   |-- base.css
|   |   |-- components.css
|   |   |-- layout.css
|   |   `-- views.css
|   `-- js/
|       |-- app.js
|       |-- config/
|       |   |-- navigation.js
|       |   `-- supabase.js
|       |-- data/
|       |   `-- seed-data.js
|       |-- services/
|       |   |-- activity.js
|       |   |-- auth.js
|       |   |-- backend.js
|       |   |-- branding.js
|       |   |-- calculations.js
|       |   |-- formatters.js
|       |   |-- supabase-client.js
|       |   |-- storage.js
|       |   `-- tenant.js
|       |-- state/
|       |   `-- store.js
|       |-- ui/
|       |   |-- brand-controls.js
|       |   |-- brand-preview.js
|       |   |-- components.js
|       |   |-- dom.js
|       |   |-- icons.js
|       |   `-- toast.js
|       `-- views/
|           |-- activity-log.js
|           |-- auth.js
|           |-- backend-setup.js
|           |-- dashboard.js
|           |-- finance.js
|           |-- inventory.js
|           |-- loading.js
|           |-- onboarding.js
|           |-- orders.js
|           |-- password-reset.js
|           |-- retailers.js
|           |-- routes.js
|           |-- settings.js
|           `-- team.js
```

## Navigation

- `src/js/views/` contains one file per major screen.
- `src/js/services/` contains reusable calculations, formatting, branding validation, activity logging, and persistence.
- `src/js/state/store.js` owns state updates so UI files stay lighter.
- `src/js/ui/` contains shared rendering helpers, brand preview controls, and icons.
- `src/js/services/tenant.js` owns client IDs, account invitations, temporary passwords, reset links, and tenant-scoped filtering.
- `src/js/services/auth.js` owns Supabase signup, login, logout, and password updates.
- `src/js/services/backend.js` owns Supabase workspace loading, company creation, account invites, membership activation, and saved activity logs.
- `supabase/schema.sql` owns the database tables, helper functions, and RLS policies.
- `src/js/views/settings.js` owns company-wide tenant settings, personal profile settings, and password changes.
- `src/js/views/activity-log.js` owns the read-only activity history and its filters.
