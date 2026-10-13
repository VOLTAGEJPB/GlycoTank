# Publishing GlycoTank on Google Play

Everything to paste is in `store/listing.md`. The signed upload bundle is
`C:\clauddeee\GlycoTank-1.0.0.aab` (rebuild: `npm run sync`, then
`android\gradlew.bat bundleRelease`). The upload keystore is in
`%LOCALAPPDATA%\GlycoTank-signing`. Back it up somewhere safe, because losing it
means asking Google to reset the upload key.

## 0. Check the account type (decides the path to production)

Play Console → Settings → Developer account → Account details.
Personal accounts created after 13 November 2023 must run a **closed test with at
least 12 testers who stay opted in for 14 days** before they can apply for
production. Organization accounts and older personal accounts can skip that.

## 1. Create the app

Home → **Create app**
- App name: `GlycoTank: Carb & Fuel Tracker`
- Default language: English (United States)
- App or game: **App**. Free or paid: **Free**
- Tick the declarations → **Create app**

## 2. Set up your app (Dashboard → "Set up your app")

| Task | Answer |
|---|---|
| Privacy policy | `https://glycotank.voltagejpb.com/privacy/` |
| App access | **All or some functionality is restricted** → add instructions: name "Reviewer account", email/password from `%LOCALAPPDATA%\GlycoTank-signing\app-review-account.txt`, note "Tap *I have an account*" |
| Ads | **No** |
| Content rating | Questionnaire: category *Health & fitness / reference*; no violence, sexual content, profanity, drugs, gambling; users don't interact or share content; no location sharing; no digital purchases → expect **Everyone** |
| Target audience | **18 and over** only |
| News app | No |
| COVID-19 contact tracing / status | Neither |
| Data safety | Use the answers in `store/listing.md` → "Google Play Data safety" |
| Government app | No |
| Financial features | None |
| Health apps | Tick **Fitness / nutrition tracking**; not a medical device |
| Account deletion | URL: `https://glycotank.voltagejpb.com/privacy/` (in-app: Settings → Account → Delete account) |

## 3. Store listing (Grow users → Store presence → Main store listing)

- Short and full description: `store/listing.md`
- App icon 512×512: `store/icon-512-google.png`
- Feature graphic 1024×500: `store/feature-graphic.png`
- Phone screenshots: `store/screenshots/google-phone/*.png`
- Category **Health & Fitness**, contact email, website `https://glycotank.voltagejpb.com`

## 4. First release

1. Testing → **Internal testing** → Create new release.
2. Choose **Use Google-generated key** (Play App Signing), the default.
3. Upload `GlycoTank-1.0.0.aab`. Release notes: "First release of GlycoTank."
4. Testers tab → create an email list with your own Gmail → copy the opt-in
   link, open it on your Android phone and install. This is the fastest real-device check.
5. Then **Closed testing** with 12+ testers for 14 days (if step 0 says so), and
   finally **Production** → Create release → promote the same build.

## After Play App Signing is on

Play re-signs the app with its own key. Copy **App integrity → App signing key
certificate → SHA-1/SHA-256**; these are needed if we ever add Android App Links.
