# DIANE Clothing Shop — Consolidated Update Notes

This folder is a consolidated source update based on the `diane-dclothing-final.zip` React + TypeScript + Vite export. It is not a replacement Supabase project and contains no database reset or destructive SQL.

## Included updates

- Customer wishlist storage is scoped by authenticated user ID in the browser and synced to that user's Supabase Auth metadata.
- Cart color selection is retained in a per-user browser-side sidecar because the existing cart/order item schema exposed by the supplied project does not include a color column. This is same-browser persistence only; it is not cross-device or server-persisted. The app prevents a conflicting colour from silently merging into the same product/size cart row.
- Cart quantity changes check the product stock limit.
- Successful checkout stores the current browser's cart colour snapshot for the order, clears the cart, and provides a direct My Orders action.
- Customer profile can open directly on the Orders tab after checkout.
- Homepage New Arrivals prefers products marked as new and falls back to the newest existing products if no products are flagged. The existing bundled hero image was changed to the unbranded local asset.
- Product image upload keeps the array positions stable as `[front, back, side]`, including when the back image is missing and only a side image is uploaded. Local file preview URLs are revoked when no longer needed.
- Rider administration UI supports create/edit/activate/deactivate. It calls a secure Edge Function; the service-role key is used only inside the Edge Function, never in browser code.
- Riders with active `Shipped` or `Out for Delivery` assignments cannot be deactivated until those orders are completed or reassigned.
- Inactive rider profiles are blocked from opening the Rider portal; the authenticated profile is also refreshed from Supabase Realtime so a currently signed-in rider is signed out after deactivation is published.
- Admin order actions show backend errors, and the Out for Delivery option is disabled until an active rider has been assigned. Delivered remains a rider-only action in the UI.
- The customer checkout explicitly labels GCash/Maya as simulated school-project demo payments. It does not claim a real wallet transfer or payment-proof review.
- The camera implementation improves secure-context checks, video readiness, GPU-to-CPU MediaPipe fallback, error feedback, and stream/landmarker cleanup.

## Important existing-schema limitations

1. **Cart/order colour persistence:** The current cart/order item fields used by this project do not include a colour column. The update therefore stores colour in browser localStorage for the signed-in user and captures an order snapshot on that same browser after checkout. It will not follow the account to another device or appear in other users' order views. A proper cross-device implementation requires a reviewed database migration adding a colour field to the relevant cart/order item records and updating the checkout RPC. No migration is included here.
2. **My Reviews:** The supplied review RPCs expose public product reviews and per-product review eligibility, but the project does not provide a verified user-specific review-list endpoint. My Reviews therefore remains a list of products the eligibility RPC says were already reviewed; it does not fabricate or expose a user's private review rows. A proper review-history page requires an authorized `get_my_reviews` RPC or confirmed table schema/policy.
3. **GCash/Maya:** The current project implements demo payment-status simulation through the existing `confirm_demo_payment` RPC. It does not implement a real GCash/Maya payment gateway or proof-upload/review workflow. Real payments require a provider integration and secure server-side verification.
4. **Product images:** The gallery supports separate Front, Back, and Side images, but each product still needs its individual image files uploaded in Admin. Missing views display as unavailable; they are not duplicated.
5. **Virtual Try-On:** The camera requires HTTPS or `localhost`. An HTTP LAN address such as `http://192.168.x.x:8443` is not a secure browser context and cannot be made camera-capable by frontend code. Production HTTPS hosting is required for phone access on another network.
6. **RLS and live backend:** The ZIP does not include the production database policies, RPC definitions, or live data. Database permissions, RPC return shapes, storage policies, and camera/MediaPipe performance must be verified against the connected Supabase project and a real camera.

## Required one-time Supabase Edge Function deployment

The Admin Rider Management page uses the function in `supabase/functions/admin-riders/index.ts`.

Deploy it to the existing Supabase project (not a new project):

```powershell
supabase functions deploy admin-riders --project-ref YOUR_EXISTING_PROJECT_REF
```

Supabase Edge Functions normally provide `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` at runtime. Confirm those server-side environment variables are available in the function environment. Do not place the service-role key in `.env` exposed to Vite, React code, or a committed file.

The function verifies the caller's Supabase session and checks that their `profiles.role` is `admin` before using server-side Auth Admin APIs. It only creates/updates/deactivates profiles whose role is `rider`.

## Local verification

From the project root:

```powershell
pnpm install
pnpm build
pnpm dev
```

Then test the customer, rider, and admin portals against the existing Supabase project with test accounts and test orders. Do not use real customer records for destructive tests.
