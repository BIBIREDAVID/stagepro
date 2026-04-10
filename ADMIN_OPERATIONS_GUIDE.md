# StagePro Admin Operations Guide

## Purpose

This guide explains how the StagePro admin should run day-to-day platform operations before launch and in early production.

StagePro currently uses:

- Squad for customer payments
- manual organizer payouts
- admin-side payout tracking inside the app

Important:

- organizer payouts are not automated yet
- money does not go directly from the app to the organizer
- the admin must transfer payout funds manually, then record the payout in StagePro

## Admin Access

Admin-only pages are available to users whose Firestore user document has:

```json
{
  "role": "admin"
}
```

Primary admin routes:

- `/admin`
- `/admin/payouts`

If admin access does not appear:

1. confirm the user document has `role: "admin"`
2. sign out
3. sign back in

## How Money Flows

Current flow:

1. A buyer pays for a ticket through Squad.
2. The payment is collected into the StagePro/owner Squad account.
3. Tickets are created after successful verification.
4. StagePro calculates what each organizer is owed after fees.
5. The admin manually sends money to the organizer.
6. The admin records that payout in `/admin/payouts`.

This means:

- the money comes from your business funds or Squad balance
- StagePro only tracks payouts
- StagePro does not automatically send bank transfers yet

## Core Weekly Admin Routine

Use this process each payout cycle.

### 1. Review organizer balances

Open:

- `/admin`
- `/admin/payouts`

Check:

- organizer name and email
- bank details
- gross sales
- net payout
- paid out total
- outstanding balance

### 2. Confirm bank details

Before sending money, make sure the organizer has:

- bank name
- account name
- account number

If details are missing:

- do not pay yet
- contact the organizer
- ask them to update their payout details in their profile

### 3. Transfer money manually

Send the payout from:

- your business bank account
- or your Squad/business funds

StagePro does not execute this transfer for you.

### 4. Record payout in StagePro

After transfer:

1. open `/admin/payouts`
2. find the organizer
3. enter payout amount
4. add a note

Recommended note examples:

- `Bank transfer - 31 Mar 2026`
- `Paid via GTBank - ref 123456789`
- `Partial settlement for March events`

5. click `Mark as paid`

This updates:

- recent payout history
- organizer paid-out total
- organizer outstanding balance

### 5. Verify organizer view

Optionally confirm that:

- the payout appears in admin history
- the organizer dashboard payout figures are updated

## Organizer Validation Routine

Organizers use `/validate` to check tickets at entry.

What should happen:

1. organizer scans or enters a ticket ID
2. valid ticket for their event is accepted
3. used ticket is rejected
4. another organizer's ticket is rejected

Admin spot-check:

- test one valid ticket
- test one already-used ticket
- test one ticket from another organizer's event

## Ticket Recovery Routine

Customers use `Find My Tickets`.

Current secure flow:

1. customer enters email
2. StagePro sends a secure email link
3. customer clicks the link
4. tickets are shown after verification

Admin check:

- confirm recovery emails are being delivered
- confirm ticket list does not appear before email verification

## Payment Operations

For paid events, confirm this full flow works:

1. customer starts checkout
2. Squad payment succeeds
3. payment is verified
4. ticket is created
5. ticket page opens
6. confirmation email is sent

If a customer says payment succeeded but no ticket appeared:

Check:

- Squad callback/verification path
- Firestore `tickets` collection
- payment reference
- confirmation email status

## Launch-Day Checklist

Before launch, confirm:

- Squad live/test environment is correct
- email env vars are set
- `TICKET_ACCESS_SECRET` is set
- admin account can access `/admin`
- organizers can access dashboard and scanner
- Find My Tickets flow works
- at least one successful paid checkout has been tested

## Recommended Environment Variables

StagePro currently relies on these important env vars:

- `VITE_SQUAD_PUBLIC_KEY`
- `SQUAD_SECRET_KEY`
- `GMAIL_USER`
- `GMAIL_PASS`
- `TICKET_ACCESS_SECRET`
- `VITE_SHEETS_URL` if Sheets logging is still enabled

## Incident Handling

### If ticket validation fails

Check:

- whether the ticket exists
- whether it is already used
- whether the organizer owns the event

### If organizer cannot see payout data

Check:

- organizer is signed into the correct account
- payout records exist
- bank details are present
- Firestore rules are updated correctly

### If admin cannot access admin pages

Check:

- user document has `role: "admin"`
- account is the same account used to log in
- sign out and sign back in

## Current Limitations

Current system limitations:

- payouts are manual, not automated
- ticket creation still relies on client-side creation logic for now
- the app is still heavily centralized in `src/App.jsx`

These are acceptable for launch, but should be improved later.

## Recommended Next Improvements

After launch, prioritize:

1. move ticket creation fully to a trusted backend flow
2. tighten Firestore rules further
3. make ticket recovery links single-use
4. automate payouts through Squad transfers or subaccounts
5. split `src/App.jsx` into smaller modules

## Short Admin Summary

The admin's job in StagePro right now is:

- monitor organizer sales and balances
- transfer payout funds manually
- record payouts in the admin dashboard
- verify ticketing and recovery flows are working
- keep platform operations clean and accurate
