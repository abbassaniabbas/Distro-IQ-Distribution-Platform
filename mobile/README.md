# DistroIQ Mobile

This folder contains the Expo and React Native mobile app. It is separate from the browser platform in the project root, but follows the same DistroIQ roles, tenant boundaries, stock model, and visual identity.

## First usable release

The first release intentionally contains two focused destinations:

1. **Today** - the Sales Representative dashboard with today's sales, money collected, assigned stock, target progress, recent sales, network status, and pending sync state.
2. **Sell** - a fast sale flow for choosing a customer, entering one or more product quantities, selecting Cash, Transfer, POS, or Credit, validating the customer's available credit, and completing the sale.

A sale can be recorded while offline. It is saved locally, assigned a unique reference, removed from the representative's available stock, and placed in the sync queue. The sample sync gateway completes the same flow locally; it is the single adapter to replace with Supabase calls.

## Navigation flow

```text
Splash / restore local session
        |
        v
Today's dashboard -----> New sale
        ^                    |
        |                    v
        +------------- Sale confirmation
```

The next release can add Customers, Payments, Stock Requests, History, and Profile without changing the first two routes.

## Project structure

```text
mobile/
  assets/                  App icon and brand assets
  src/
    auth/                  Role permissions
    components/            Reusable buttons, cards, selectors, badges, and states
    data/                  Local sample data
    navigation/            Typed navigation and route definitions
    screens/               Full mobile screens
    services/              Storage and remote sync adapters
    state/                 App state, persistence, and stock updates
    theme/                 Colours, spacing, type, radius, and shadow tokens
    types/                 Shared business types
    utils/                 Formatting and validation
    App.tsx                 Providers and app entry
  app.json                 Expo app configuration
  package.json             Mobile-only dependencies and commands
```

## Supabase assumptions

- Supabase Auth supplies the signed-in user. The app does not trust a role selected on the device.
- Every server record includes `client_id`, and row-level security derives that client from the signed-in account.
- Assigned stock is read from a server-owned stock ledger rather than calculated only on the phone.
- Completing a sale should call one PostgreSQL function or API transaction that validates stock, checks credit, writes the sale and sale lines, updates the stock ledger, and records the audit event together.
- Each mobile sale sends its local sale reference as an idempotency key so retrying an offline sale cannot create a duplicate.
- Price and product names are copied onto each sale line so later catalogue changes never alter past transactions.
- The server remains authoritative when offline edits conflict. The app should show a clear retry or review state instead of silently dropping a sale.

## Role access

The permission map is in `src/auth/permissions.ts`. This release opens the Sell route only for a user with `sales:create`. Later role navigators can reuse the same permission checks for Store Keeper, Accountant, and CEO screens.

## Run locally

```bash
cd mobile
npm install
npm start
```

Use Expo Go on an Android phone or press `a` in the Expo terminal when an Android emulator is available.

## Test this release

1. Check the dashboard on a small Android screen around 360 x 640 and confirm text does not clip.
2. Open Sell, choose a customer, enter product quantities with both the keypad and step buttons, and complete Cash, Transfer, and POS sales.
3. Record a Credit sale within a customer's available credit, then try one above the limit and confirm it is blocked.
4. Confirm a completed sale reduces Assigned Stock and appears under Recent Sales on Today.
5. Turn off the phone's connection, record a sale, and confirm Working offline appears and the sale remains after restarting the app.
6. Restore the connection and confirm the pending sale changes to synced.
7. Confirm the keyboard never covers the total or Complete sale button.

Login, customer creation, payment collection, stock requests, full history, and profile settings are deliberately reserved for the next releases.
