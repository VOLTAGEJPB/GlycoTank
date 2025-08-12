GlycoTank — Professor Pack
==========================

What this is
------------
A self-contained copy of the GlycoTank web app plus a (debug) Android APK.

How to run the web app (easiest)
--------------------------------
Windows: double-click  Start-Web-Windows.bat
macOS:   double-click  Start-Web-Mac.command

Those will try to start a tiny local server (Node or Python). If neither is available,
they will open index.html directly (everything works except the "Install App" PWA step).

Manual (optional):
- If you have Node:     npx http-server ./GlycoTank-web -p 8080 -c-1
- If you have Python:   cd GlycoTank-web && python -m http.server 8080
Then visit http://localhost:8080

Android (optional)
------------------
Inside Android/ you'll find an APK (app-debug.apk) if the build succeeded.
To install:
1) Enable "Install unknown apps" on your Android device
2) Copy APK to device and open it, OR use ADB:
   adb install -r Android\GlycoTank-debug.apk

Data & privacy
--------------
- 100% local: all data stays in your browser/app (localStorage). No server.
- To reset data, open the "History & Export" tab and click "Clear All Data".
- Export CSV/JSON from History at any time.

Questions?
----------
This pack was generated on 20250812-184946. If anything looks off, please ping the student. 🙂
