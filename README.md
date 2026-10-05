# cleaner

A command-line tool that finds files you don't need, has Gemini double-check them, saves everything to a plain text database, and removes what you pick.

## How it decides

1. **Local rules** walk your folders and find candidates: unfinished downloads, temp files, crash dumps, app and package caches (pip, npm, Nuitka), `node_modules`, `__pycache__`, `.next`, old app versions, extracted archives, old installers in Downloads, and byte-for-byte duplicates (checked by SHA-1).
2. **Content check**: the first 4 KB of each candidate file reveals its real type (program, archive, photo, video, database). Small text files get a short preview, with secrets, long tokens and emails masked. Files that look like credentials never get a preview.
3. **Gemini** (free tier, Flash-Lite first) reviews the candidates in batches of 40 and answers *remove*, *review* or *keep*, with a reason.
4. **Safety rule**: an item is only marked *safe to remove* when a local rule has hard evidence **and** Gemini agrees. Gemini on its own can only suggest *your call*. Anything that looks like a secret, or a duplicate kept in a Backup folder, is always *your call*.

System folders (`Windows`, `Program Files`, `ProgramData`, the Recycle Bin), `.git` folders and global npm tools are never touched.

## Use

```powershell
cleaner scan                      # scan your user folder
cleaner scan D:\Downloads C:\dev  # scan specific folders
cleaner list                      # show the last results
cleaner clean                     # pick what to delete
cleaner clean --dry-run           # show what would be deleted
cleaner export                    # write the removal script from the last scan
```

When a scan finishes, cleaner asks one question:

- **y** deletes the safe items right away and shows how much space came back.
- **n** (or Enter) deletes nothing and writes `cleaner-remove.ps1` plus a double-clickable `cleaner-remove.bat`. Safe items are switched on in the script; your-call items are written but commented out, so you remove the `#` to include one. The script lists everything and asks y/N again before deleting. Running it is your call.

Without installing, run `.\cleaner.cmd` from this folder, or `node bin\cleaner.js`.

To get a global `cleaner` command:

```powershell
npm link
```

## The database

Results go to `cleaner-db.txt` (tab-separated, opens in Notepad or Excel):

```
id  status   verdict  confidence  size_bytes  size     category          path                                 reason
1   pending  remove   0.98        5242880     5.0 MB   partial-download  C:\Users\you\Downloads\x.crdownload  Unfinished download...
```

- `verdict`: `remove` means safe, `review` means your call.
- `status`: `pending`, `removed`, `failed` or `missing`. Change a row's status to `keep` and cleaner will leave it alone.

Deletion is permanent (it frees space right away). Nothing is deleted until you choose items and type `YES`.

## Options

| Option | What it does |
|---|---|
| `--offline` | Local rules only, nothing is sent to Gemini |
| `--no-content` | Gemini gets names, sizes and dates, but no previews |
| `--max-ai <n>` | Ask Gemini about at most n items, biggest first (default 400) |
| `--large <MB>` | Also ask about any file bigger than this (default 200) |
| `--exclude <dir>` | Skip a folder (repeatable) |
| `--model <name>` | Try this model first |
| `--db <file>` | Use another database file |
| `--out <dir>` | Where the removal script goes (default: next to the database) |
| `--dry-run` | With `clean`: list, don't delete |

## Setup

Put a free key from <https://aistudio.google.com/apikey> in `.env`:

```
GEMINI_API_KEY=your-key
```

`.env` and `cleaner-db.txt` are git-ignored. Needs Node 22 or newer, no npm packages.

## Privacy

With Gemini on, file paths, sizes, dates and short masked previews of small text files are sent to Google. On the free tier, Google may use that data to improve its products. Use `--no-content` to send no previews, or `--offline` to send nothing.
