# StagePro Project Rundown

## Overview

StagePro is a Nigeria-focused event ticketing platform built with React, Vite, Firebase, and Vercel. It supports event discovery, organizer event management, paid and free ticket checkout, QR-based ticket validation, email ticket delivery, reviews, waitlists, attendee notifications, and a manual organizer payout workflow.

The product currently operates as a single-page application with most of the frontend logic concentrated in [`src/App.jsx`](/C:/Users/HomePC/Desktop/stagepro%20-%20Copy/src/App.jsx). Payments are handled through Squad, ticket and app data are stored in Firebase, and transactional email is sent through Vercel serverless functions using Nodemailer.

## Core Product Areas

### Attendee experience

- Browse and view public events
- Register or log in as an attendee
- Buy free or paid tickets
- Receive ticket confirmation emails
- View ticket details and QR code
- Download ticket to mobile
- Find tickets later
- Leave reviews for attended events
- Receive event notifications
- Join waitlists for sold-out tiers

### Organizer experience

- Register or log in as an organizer
- Create, edit, and manage events
- View dashboard metrics and analytics
- Download attendee CSV exports
- Scan and validate tickets at entry
- Track revenue, fees, and payout estimates
- Save bank details for manual payouts

### Admin / platform operations

- Verify Squad payments server-side
- Send ticket and notification emails through API routes
- Review organizer payout readiness
- Record manual payouts
- Track payout history

## Tech Stack

### Frontend

- React 19
- React Router DOM 7
- Vite 7
- Single-file app architecture in [`src/App.jsx`](/C:/Users/HomePC/Desktop/stagepro%20-%20Copy/src/App.jsx)

### Backend / platform services

- Firebase Authentication
- Firestore
- Firebase Storage
- Vercel serverless functions in [`api`](/C:/Users/HomePC/Desktop/stagepro%20-%20Copy/api)
- Nodemailer for email delivery
- Squad for card/bank transfer checkout

### Deployment

- Vercel
- SPA rewrite plus explicit `/api/*` routing in [`vercel.json`](/C:/Users/HomePC/Desktop/stagepro%20-%20Copy/vercel.json)

## Main Frontend Surfaces

The application’s major pages/components currently include:

- App shell and shared app state: [`src/App.jsx`](/C:/Users/HomePC/Desktop/stagepro%20-%20Copy/src/App.jsx#L559)
- Ticket page: [`src/App.jsx`](/C:/Users/HomePC/Desktop/stagepro%20-%20Copy/src/App.jsx#L1168)
- Home page: [`src/App.jsx`](/C:/Users/HomePC/Desktop/stagepro%20-%20Copy/src/App.jsx#L1315)
- Auth page: [`src/App.jsx`](/C:/Users/HomePC/Desktop/stagepro%20-%20Copy/src/App.jsx#L1534)
- Event page: [`src/App.jsx`](/C:/Users/HomePC/Desktop/stagepro%20-%20Copy/src/App.jsx#L1677)
- Checkout page: [`src/App.jsx`](/C:/Users/HomePC/Desktop/stagepro%20-%20Copy/src/App.jsx#L2009)
- Organizer dashboard: [`src/App.jsx`](/C:/Users/HomePC/Desktop/stagepro%20-%20Copy/src/App.jsx#L2369)
- Create event page: [`src/App.jsx`](/C:/Users/HomePC/Desktop/stagepro%20-%20Copy/src/App.jsx#L3001)
- Ticket validation page: [`src/App.jsx`](/C:/Users/HomePC/Desktop/stagepro%20-%20Copy/src/App.jsx#L3045)
- Analytics page: [`src/App.jsx`](/C:/Users/HomePC/Desktop/stagepro%20-%20Copy/src/App.jsx#L3306)
- Admin payouts page: [`src/App.jsx`](/C:/Users/HomePC/Desktop/stagepro%20-%20Copy/src/App.jsx#L3694)
- Profile page: [`src/App.jsx`](/C:/Users/HomePC/Desktop/stagepro%20-%20Copy/src/App.jsx#L3941)
- Reviews page: [`src/App.jsx`](/C:/Users/HomePC/Desktop/stagepro%20-%20Copy/src/App.jsx#L4264)

## Main User Flows

### Event discovery and purchase

1. User browses events on the home page.
2. User opens an event page and selects ticket quantities.
3. Free orders create tickets immediately.
4. Paid orders open Squad checkout.
5. After payment, the app verifies the transaction through the backend.
6. Tickets are created or found.
7. User is redirected to the ticket page.
8. Ticket confirmation email is sent.

### Ticket validation

1. Organizer opens the scan/validation surface.
2. Ticket QR or ID is submitted.
3. Ticket is checked against Firestore.
4. Ticket is marked as used if valid and owned by the organizer’s event.

### Organizer revenue and payout operations

1. Organizer creates and sells tickets for events.
2. Dashboard calculates gross sales, platform fees, Squad fees, and net payout.
3. Organizer adds payout bank details in profile.
4. Admin reviews organizer status on `/admin/payouts`.
5. Admin records manual payouts into the `payouts` collection.
6. Organizer dashboard reflects amounts already paid and remaining outstanding.

## Data Model

The project currently uses Firestore collections directly from the frontend and serverless functions.

### Key collections

- `users`
  - account identity and role
  - organizer payout details
- `events`
  - public event listing data
  - tiers, dates, venue, imagery, organizer ownership
- `tickets`
  - ticket holder identity
  - event metadata snapshot
  - payment reference
  - validation state
- `reviews`
  - attendee ratings and feedback
- `waitlist`
  - sold-out ticket demand
- `notifications`
  - in-app organizer-to-attendee communication
- `payouts`
  - manual organizer payout records
- `enquiries`
  - support/contact submissions

### Payout-related data

Organizer payout details are stored under the user document as `payoutDetails`, currently containing:

- `bankName`
- `accountName`
- `accountNumber`
- `notes`

Manual payout records in `payouts` currently store:

- `organizerId`
- `organizerName`
- `amount`
- `notes`
- `status`
- `createdAt`
- `paidAt`
- `recordedBy`
- `bankSnapshot`

## Payments

Squad is the active payment provider.

### Current flow

- Frontend uses `VITE_SQUAD_PUBLIC_KEY`
- Checkout opens Squad inline
- Verification is done through [`api/finalize-squad-order.js`](/C:/Users/HomePC/Desktop/stagepro%20-%20Copy/api/finalize-squad-order.js)
- Verification checks:
  - payment reference
  - amount
  - currency
  - customer email

### Current payout model

Organizer payouts are manual, not automated.

- Buyers pay through the platform’s Squad account
- The app calculates platform fee, Squad fee, and organizer net
- Admin records when organizers have been paid
- No automated bank transfer or split settlement is implemented yet

## Email and Notifications

Serverless email routes include:

- Ticket email: [`api/send-ticket-email.js`](/C:/Users/HomePC/Desktop/stagepro%20-%20Copy/api/send-ticket-email.js)
- Ticket resend: [`api/resend-ticket-email.js`](/C:/Users/HomePC/Desktop/stagepro%20-%20Copy/api/resend-ticket-email.js)
- Organizer notification email: [`api/send-notification-email.js`](/C:/Users/HomePC/Desktop/stagepro%20-%20Copy/api/send-notification-email.js)

Emails are sent with Gmail credentials via Nodemailer.

In-app notifications are also stored in Firestore and shown to attendees in the app.

## Environment / Configuration Notes

Important environment variables currently in use include:

- `VITE_SQUAD_PUBLIC_KEY`
- `SQUAD_SECRET_KEY`
- `GMAIL_USER`
- `GMAIL_PASS`
- `VITE_SHEETS_URL`

There are also comments referencing EmailJS setup, but the current active email flow is Vercel API + Nodemailer.

## Current Project Strengths

- Strong feature breadth for a single repo
- End-to-end attendee purchase flow
- Organizer management tools
- Ticket QR and validation flow
- Email delivery integration
- Review, waitlist, and notification support
- Manual payout operations now supported

## Current Technical Risks / Constraints

### 1. App complexity is concentrated in one file

[`src/App.jsx`](/C:/Users/HomePC/Desktop/stagepro%20-%20Copy/src/App.jsx) contains most of the application logic. This makes it harder to:

- isolate bugs
- test features
- refactor safely
- reason about data boundaries

### 2. Large frontend bundle

The production build currently passes, but Vite warns that the main JS chunk is large. This points to a future need for code splitting or modularization.

### 3. Firebase config is embedded in the frontend

Firebase web config is currently hardcoded in [`src/App.jsx`](/C:/Users/HomePC/Desktop/stagepro%20-%20Copy/src/App.jsx). That is common for Firebase web apps, but the project still needs strong Firestore rules because client-side hiding is not a security boundary.

### 4. Manual payout operations depend on admin discipline

Because payouts are recorded manually:

- payout accuracy depends on admin workflow
- duplicate payout records are possible if not carefully managed
- there is no automatic bank transfer confirmation

## Suggested Next Steps

### Short term

- Split `src/App.jsx` into pages, shared components, and Firebase/service helpers
- Add clearer Firestore security rules for organizer/admin data
- Add duplicate-protection or reference checks for payout recording
- Improve dashboard/export consistency

### Medium term

- Add admin roles/permissions at the rules layer
- Add richer payout statuses such as `pending`, `processing`, `paid`
- Add payout request and approval workflow
- Add audit trail for admin payout actions

### Long term

- Introduce automated Squad settlement or transfer workflows
- Move more sensitive business logic out of the client and into server-side endpoints
- Add formal testing around checkout, validation, and payout flows

## Build Status

As of the latest verification in this workspace:

- `npm run build` passes successfully

## Bottom Line

StagePro is already a substantial event commerce platform, not just a landing page or simple CRUD app. It has real operational depth: payments, ticket issuance, QR validation, email delivery, organizer tooling, and now a workable manual payout system.

Its biggest challenge now is not missing features as much as maintainability. The project would benefit most from codebase modularization, stronger security boundaries, and gradual movement of critical business logic away from the giant frontend file and into clearer service layers.
