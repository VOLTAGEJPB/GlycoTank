# Google OAuth verification: Gmail "Email receipts"

Project: Google Cloud project number 1056070324618 (the Gmail OAuth client used by the iOS app).
Scope: `https://www.googleapis.com/auth/gmail.readonly` (restricted).

## 1. Publish the app (stops "Access blocked")

Google Cloud console → Google Auth Platform → **Audience** → Publishing status "Testing" → **Publish app** → Confirm.
After this, anyone can link Gmail after a "Google hasn't verified this app" screen (Advanced → Go to GlycoTank), up to 100 users, until verification passes.

## 2. Branding page (Google Auth Platform → Branding)

- App name: GlycoTank
- User support email: support@glycotank.com
- App logo: store/icon-1024.png (resize to 120×120)
- App home page: https://glycotank.com/
- Privacy policy: https://glycotank.com/privacy/
- Terms (optional): leave empty
- Authorized domain: glycotank.com. It must be verified in Google Search Console with the same Google account. Search Console → Add property → Domain → glycotank.com → add the TXT record in Cloudflare DNS.
- Developer contact: support@glycotank.com

## 3. Data access → scope justification (paste)

> GlycoTank is a nutrition and training log. The optional "Email receipts" feature lets a user find the food they ordered from restaurants and delivery apps (for example DoorDash, Uber Eats, Grubhub, Chipotle) in their order confirmation emails, so they can add those meals to their food log without typing them. The app searches the user's Gmail for order confirmation emails from food merchants, reads those messages to list the ordered items, and shows them to the user, who chooses which items to log. gmail.readonly is the narrowest scope that allows reading message bodies, which is where the ordered items are listed. gmail.metadata does not include message bodies. The app never sends, modifies or deletes email.
>
> All email processing happens on the user's phone. Email content is not sent to or stored on GlycoTank's servers, shared with third parties, or used for advertising. Only the food items the user chooses to log are saved, like any other meal entry. Users can unlink Gmail in the app at any time.

How the data is used (short field): "Read food order confirmation emails on the user's device to list ordered items the user can add to their food log. Not stored on servers, not shared, not used for ads."

## 4. Demo video (YouTube, unlisted)

Record on the iPhone with Screen Recording (Control Center), about 1–2 minutes, and upload to YouTube as **Unlisted**. Google needs to see:

1. Open GlycoTank → More → Email receipts → **Link Gmail**.
2. The Google consent screen, with the **app name "GlycoTank"** visible. Tap the account picker so the URL bar shows `accounts.google.com`, and if possible tap the URL to show the `client_id=1056070324618-...` part.
3. The permission screen listing "Read your email messages and settings". Tap Continue/Allow.
4. Back in GlycoTank: the list of food orders found. Open one and add an item to a meal, showing it appear in Meals.
5. Show **Unlink Gmail** in More → Email receipts.

Say or caption: "GlycoTank reads only food order emails, on the phone, to let the user log what they ordered."

## 5. Security assessment (CASA)

Google requires an annual third-party security assessment when restricted-scope data is **stored on or sent to a server**. GlycoTank reads Gmail only on the device and never sends email data to its servers. In the verification form, state this clearly (use the paragraph in section 3). Google decides whether an assessment is still required. If they ask for one, tell Claude before paying, so the cost and options (or switching to a forwarding address) can be weighed.

## 6. Submit

Google Auth Platform → Verification Center → **Prepare for verification** → review → **Submit**. Replies come to the developer contact email. Typical turnaround is a few weeks.
