## Cleaner 1.4.0

**Updates on their own.** The installed app now checks GitHub for new versions, downloads them in the background, verifies them against the published SHA-512, and installs when you close it. See Settings, under Updates.

**A welcome on first launch** that walks you to the four tools: Clean, Protect, Organize and Map.

**Quieter, faster threat scans**
- Machine-made YARA rules (yara-signator), which also match ordinary compiler code, now only count as a weak sign. A valid digital signature overrules a YARA-only verdict. This removes false alarms on programs such as Python's own launchers.
- Windows' own Recent-items shortcuts (`photo.pdf.lnk`) are no longer mistaken for disguised programs. A shortcut header check had been comparing the wrong number of bytes.
- Script files inside your own code projects are skipped.
- Repeat scans reuse the fingerprints and signatures of unchanged files.
- YARA runs in batches with progress, so one slow batch can't stall the whole scan.

**Tested end to end.** Every release is built by GitHub Actions after the engine tests and Playwright tests that drive the real app.

The installer is not code-signed yet, so Windows SmartScreen may ask you to confirm the first launch.
