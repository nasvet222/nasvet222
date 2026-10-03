# NASVAY Fashion E-commerce

A full-stack starter for the NASVAY fashion store.

## Included

- Responsive fashion storefront
- Product listing and product detail pages
- Local shopping cart
- Customer registration/login with secure password hashing
- Customer order history
- Checkout and delivery form
- Paystack server-side transaction initialization
- Paystack payment verification
- Paystack webhook signature verification
- Stock deduction after successful payment
- Admin account
- Admin order management/status updates
- Admin product creation/deactivation
- SQLite database

## Requirements

Node.js 18+ (Node 20+ recommended).

## Run locally

1. Extract the ZIP.
2. Open a terminal in the project folder.
3. Run:

```bash
npm install
```

4. Copy `.env.example` to `.env`.
5. Put your Paystack TEST secret key in `PAYSTACK_SECRET_KEY`.
6. Change `JWT_SECRET` and `ADMIN_PASSWORD`.
7. Run:

```bash
npm start
```

8. Open `http://localhost:3000`.

Admin:
- URL: `http://localhost:3000/admin.html`
- Email: value of `ADMIN_EMAIL`
- Password: value of `ADMIN_PASSWORD`

## Paystack setup

The backend initializes Paystack transactions using the secret key. The secret key stays on the server.

For production:
- use HTTPS
- set `BASE_URL` to your real HTTPS domain
- add `/api/paystack/webhook` as the Paystack webhook URL
- use a live Paystack secret key only after your business is activated
- do not commit `.env` to Git

The webhook verifies Paystack's `x-paystack-signature` using HMAC-SHA512 before processing a successful charge.

## Important production upgrades

Before a real launch, add:
- CSRF protection and rate limiting
- email verification/password reset
- server-side shipping fee/tax rules
- stronger admin roles/permissions
- image upload storage (S3/Cloudinary/etc.)
- database backups
- audit logs
- proper transactional stock reservation for high traffic
- order cancellation/refund workflow
- privacy/terms/returns pages
- monitoring and error logging
