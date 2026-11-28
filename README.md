<div dir="rtl">

# ورس‌آبس (Versobs)

**ابزارهای هوش مصنوعی ورس‌لاین، داخل Obsidian**

- 🎙️ **پیاده‌سازی متن** فایل‌های صوتی و ویدیویی والت (یا لینک) به یادداشت
- 📄 **خلاصه‌سازی** یادداشت، PDF، Word و PowerPoint یا متن انتخاب‌شده
- 🌐 **ترجمه‌ی** یادداشت یا ترجمه‌ی متن انتخاب‌شده در همان‌جا
- 🖨️ **خروجی Word و PDF** از یادداشت‌ها و پوشه‌ها (با پشتیبانی فارسی و راست‌به‌چپ)
- ❓ **سؤال و فلش‌کارت** (Anki، CSV، HTML) · 🎞️ **اسلاید** از یادداشت
- 🧩 **کدگذاری کیفی** مصاحبه‌ها · 🎓 **نگارش فصل یافته‌ها** در دو مرحله (طرح، سپس متن کامل)
- 📣 **تلگرام:** بایگانی کانال در والت، تبدیل اسناد (PDF، Word، PowerPoint…) به یادداشت مارک‌داون، تقریر مباحثات، ساخت بسته‌ی کامل
- 🗂️ **گزارش پوشه:** آمار و فایل‌های تکراری
- 🧰 **همه‌ی ابزارهای ورس‌لاین** از یک فهرست، با فرم خودکار؛ ابزارهای جدید ورس‌لاین بدون به‌روزرسانی افزونه هم ظاهر می‌شوند

رابط افزونه فارسی و انگلیسی است (به‌طور پیش‌فرض هم‌زبان با Obsidian).

## نصب

۱. **ورس‌لاین** را نصب کنید (کار اصلی را ورس‌لاین انجام می‌دهد؛ نسخه‌ی ۱.۶ یا جدیدتر):

```sh
# مک و لینوکس
curl -LsSf https://raw.githubusercontent.com/miroverse-solutions/versline/main/install.sh | sh
# ویندوز (PowerShell)
irm https://raw.githubusercontent.com/miroverse-solutions/versline/main/install.ps1 | iex
```

۲. افزونه را با خود ورس‌لاین در والت نصب کنید:

```sh
versline obsidian install                    # آخرین والتی که باز شده
versline obsidian install --vault ~/Notes    # یا یک والت مشخص
```

۳. در Obsidian از **Settings ← Community plugins** افزونه‌ی **Versobs** را فعال کنید (فقط بار اول).

۴. در تنظیمات افزونه سرویس هوش مصنوعی و کلید API را وارد کنید (یا یک بار `versline init` را اجرا کنید).

برای **به‌روزرسانی** همان دستور `versline obsidian install` را دوباره اجرا کنید یا در Obsidian فرمان «بررسی نسخه‌ی جدید افزونه» را بزنید.

## استفاده

- روی هر فایل یا پوشه راست‌کلیک کنید: گزینه‌های ورس‌لاین بسته به نوع فایل نمایش داده می‌شوند.
- روی متن انتخاب‌شده راست‌کلیک کنید: خلاصه یا ترجمه.
- در فهرست فرمان‌ها (Ctrl/Cmd+P) «Versobs» را جستجو کنید؛ فرمان «اجرای یک ابزار ورس‌لاین…» همه‌ی ابزارها را نشان می‌دهد.
- پنل **کارهای ورس‌لاین** (آیکن نوار کناری) پیشرفت، گزارش، هزینه و خروجی هر کار را نشان می‌دهد و کارها قابل لغوند. کار ناموفق یا لغوشده دکمه‌ی **تلاش دوباره** دارد و از همان جایی که مانده ادامه می‌دهد (هزینه‌ی بخش‌های انجام‌شده دوباره پرداخت نمی‌شود). فهرست کارها بعد از بستن Obsidian هم می‌ماند؛ کاری که هنگام بستن در حال اجرا بود با دکمه‌ی **ادامه** از سر گرفته می‌شود.

</div>

---

# Versobs

**Versline's AI tools inside Obsidian:** transcription, summaries, translation, Word/PDF export, questions and flashcards, slides, qualitative coding, research writing, Telegram archives (with their PDF/Word/PowerPoint documents as Markdown notes) and folder reports. A generic runner exposes every Versline tool, including ones added after this plugin was released. The interface is in English and Persian.

The work is done by [Versline](https://github.com/miroverse-solutions/versline) (1.11 or newer for converting Telegram documents; most features work with 1.6), which must be installed on the computer. The plugin is desktop-only.

## Install

1. Install Versline: `curl -LsSf https://raw.githubusercontent.com/miroverse-solutions/versline/main/install.sh | sh` (on Windows: `irm https://raw.githubusercontent.com/miroverse-solutions/versline/main/install.ps1 | iex`).
2. Install the plugin into your vault: `versline obsidian install [--vault PATH]`.
3. Enable **Versobs** in **Settings → Community plugins** (first time only).
4. Set the AI provider and API key in the plugin settings, or run `versline init` once.

To update, run `versline obsidian install` again, or use the command **Check for plugin update**.

## Jobs

The **Versline jobs** panel shows progress, logs, cost and outputs. A failed or cancelled job has a **Retry** button; Versline resumes from its cached progress, so finished chunks are not paid for again. The job list is saved to `jobs.json` in the plugin folder: a job that was running when Obsidian closed comes back as *Interrupted* with a **Continue** button. Note-specific follow-ups (such as embedding the audio in a transcript) run only when the job is retried in the same session; after a restart, results get the standard handling (properties, open the note). **Tries per API call** in settings sets how often Versline retries each request before a job fails.

## Architecture

```
src/
  main.ts            plugin entry: settings, language, jobs, view, status bar, modules, updates
  bridge/            talks to `versline bridge` (no Obsidian imports, unit-tested)
    protocol.ts        event and manifest types, NDJSON decoder
    client.ts          one process per job: run, answer prompts, cancel
    locator.ts         find the versline executable (PATH and the usual install folders)
    schema.ts          tool parameter schema helpers (fields, defaults, output patterns)
  core/
    versobs.ts         the hub modules use: runTool (form → job → result), finish (open/stamp notes)
    module.ts          VersobsModule interface + ModuleContext (auto-cleaned registrations)
    module-host.ts     enable/disable modules at runtime
    bridge-service.ts  Versline state, manifest, per-vault AI overrides (key from SecretStorage)
    settings*.ts       data.json model with migrations; declarative settings tab (Obsidian 1.13+)
  jobs/              queue with concurrency limit, sidebar panel, status bar
  ui/                schema-driven form, prompt modal, setup help, path suggestions
  i18n/              typed strings: en.ts defines keys, fa.ts must provide all of them
  modules/           one file per feature; listed in modules/index.ts
```

**Adding a feature:** create `src/modules/<name>.ts` exporting a `VersobsModule`. In `load(ctx)`, register commands and menus through `ctx` and call `ctx.core.runTool({ tool, values, hidden })`, then `ctx.core.finish(result)`. List the module in `modules/index.ts` and add its strings to `en.ts` and `fa.ts` (the compiler reports missing Persian strings). A new **Versline** tool needs no plugin change: it appears in **Run a Versline tool…** with a form built from its schema, with labels in both languages.

**Versline side:** `versline bridge info` lists the tools with JSON Schemas and UI hints. `versline bridge run <tool>` streams NDJSON events (`progress`, `log`, `prompt`, `artifact`, `cost`, `result`, `error`). See Versline's `docs/en/library.md#bridge-protocol`.

## Development

```sh
npm install
npm run dev        # watch build into main.js
npm run build      # typecheck + production build
npm run lint       # eslint with eslint-plugin-obsidianmd
npm test           # unit tests; integration tests also run when versline is installed
VERSLINE_BIN=../versline/.venv/bin/versline npm test   # against a development checkout
```

To try it, symlink this folder into a test vault: `ln -s "$PWD" <vault>/.obsidian/plugins/versobs`.

**Release:** releases and CI are manual; pushing to `main` triggers nothing. `make bump V=0.2.0` updates `package.json`, `manifest.json` and `versions.json` and commits. Push, then run `make release` (or `make release-draft`). The Manual Release workflow builds the plugin, tags it with the manifest version and publishes `main.js`, `manifest.json` and `styles.css`, which `versline obsidian install` downloads.

License: MIT · [Miroverse Solutions](https://github.com/miroverse-solutions)
