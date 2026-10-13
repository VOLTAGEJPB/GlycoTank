# GlycoTank store listing

Character limits are noted in brackets; every field below fits.

## Shared

- **App name** (Apple 30 / Google 30): `GlycoTank: Carb & Fuel Tracker` (30)
- **Category:** Health & Fitness
- **Price:** Free, no in-app purchases, no ads
- **Support URL:** https://glycotank.voltagejpb.com/support/
- **Marketing URL:** https://glycotank.voltagejpb.com
- **Privacy policy URL:** https://glycotank.voltagejpb.com/privacy/
- **Contact email:** joel.perez5588@gmail.com
- **Content rating:** Everyone / 4+ (no user-generated content shared with others, no ads, no web browsing)
- **App review sign-in:** Apple and Google need a demo account. Create one in the app before submitting (any email you can receive a code at) and enter its email and password in App Store Connect → App Review Information and Play Console → App access.

## Apple App Store

- **Subtitle** (30): `Fuel, macros & readiness` (24)
- **Promotional text** (170, can be changed anytime without review):
  `Know when you're fueled to train. GlycoTank estimates your glycogen "fuel tank" from your meals and workouts, and plans tomorrow's carbs. No ads, never sold.` (159)
- **Keywords** (100, comma-separated, no spaces needed):
  `glycogen,carb cycling,macro tracker,meal log,workout log,protein,readiness,nutrition,fitness,diet` (97)

## Google Play

- **Short description** (80):
  `Track meals & workouts and see your glycogen fuel tank. Private, no ads.` (72)

## Full description (both stores, 4000)

Know when you're fueled to train.

GlycoTank tracks your meals and workouts and estimates your glycogen: the carbohydrate fuel stored in your muscles and liver. Watch your "fuel tank" rise with meals and drain with training, plan tomorrow's carbs, and check your readiness each morning.

FUEL TANK
• See an estimate of your glycogen level, updated with every meal and workout
• A trend chart over 7, 14 or 30 days shows how your eating and training add up
• Simple guidance: low, moderate or ready to train

CARB PLANNER
• Enter tomorrow's training and get a suggestion for how many carbs to eat today
• Eat more around hard sessions and less on rest days

MORNING READINESS
• A 10-second check-in: sleep, resting heart rate and how you feel
• Your resting heart rate is compared with your own recent average
• Get a clear call: train, go easy, or rest

PERSONAL TARGETS
• Calories, protein, carbs, fat and fiber calculated from your body, goal and training
• Built on established formulas (Mifflin-St Jeor energy needs and exercise METs)
• Fine-tune every value yourself

SCAN TO LOG
• Scan a barcode to look up the product and fill in your meal
• Snap a Nutrition Facts label and GlycoTank reads it right on your phone
• Adjust servings and every number updates

FAST LOGGING
• Quick entry: type "650 cal 70c 45p 18f" and the fields fill themselves
• Favorite meals and workouts
• Log a whole training session at once
• Rest timer and plate math built in

PRIVATE AND BACKED UP
• No ads, no tracking, and your data is never sold
• Your log is backed up privately to your account and follows you to a new phone
• Works offline and syncs when you're back online
• Export to a spreadsheet anytime, or delete your account and data in the app

GlycoTank provides general fitness and nutrition estimates. It is not a medical device and does not provide medical advice. Talk to a doctor or dietitian before making big changes to your diet or training, especially if you have diabetes or another health condition.

## What's new (version 1.0.0)

First release of GlycoTank.

## Screenshot captions (in order)

1. Know your fuel tank: Today screen with the tank gauge and trend
2. Plan tomorrow's carbs: the carb planner
3. Log meals in seconds: meal logging with quick entry
4. Every set, every session: workout logging, rest timer, plate math
5. Train, go easy or rest: morning check-in and readiness
6. Targets made for you: personalized calories and macros

## Questionnaires (answers)

**Google Play Data safety:**
- Does the app collect or share user data? **Yes, collects. Does not share.**
- Encrypted in transit: **Yes.** Users can request deletion: **Yes** (in app: Settings → Account → Delete account; web: email via the privacy policy).
- Data types collected (all **required**, **not shared**, **not processed ephemerally**, purpose **App functionality** and **Account management** only):
  - Personal info → **Email address** (account management, app functionality)
  - Health and fitness → **Health info** (resting heart rate, sleep, weight, height, age) and **Fitness info** (workouts, meals/nutrition) (app functionality)
  - Personal info → **Other info** (sex, goal)
- Not collected: location, contacts, photos (label photos are read on-device), app activity, device IDs, financial info.
- Barcode lookups send only a product barcode number to Open Food Facts; that is not user data.
- Account deletion URL (required by Play): https://glycotank.voltagejpb.com/privacy/ (section "Deleting your account and data").

**Camera:** used only when the user taps Scan barcode or Scan label. Label photos are processed on-device and not stored or uploaded.

**Apple App Privacy ("nutrition label"):** Data **is** collected. For each type below: **Linked to the user: Yes. Used for tracking: No. Purpose: App Functionality** only.
- Contact Info → Email Address
- Health & Fitness → Health (resting heart rate, sleep, weight) and Fitness (workouts, meals)
- Identifiers → User ID (account ID)
Not collected: location, contacts, photos, usage data, diagnostics, purchases.

**Apple account rules:** account deletion is in the app (guideline 5.1.1(v)) ✔. Sign in with Apple must be offered if Google sign-in is offered (guideline 4.8). Requiring an account for an app that could work on one device is a rejection risk under 5.1.1(v); if review objects, switch `ACCOUNT_REQUIRED` in src/main.js to false.

**Google Play health apps declaration:** a fitness/nutrition tracker; not a medical device. Health and fitness data is stored in the user's account only to back it up and sync it between their devices; it is never sold, shared or used for advertising.

**Ads:** none. **Target audience:** 18+ (fitness and nutrition app for adults; not designed for children).

**Notification permission (Android):** used only for the optional daily reminders the user sets. **Alarms & reminders (exact alarms):** used so those user-set daily reminders arrive at the chosen time.
