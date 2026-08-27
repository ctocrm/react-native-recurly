# Visual baseline — 2026-08-27

Dated reference of every reachable page in the running Android app on `emulator-5554` (`com.ctocrm.jsmastery/.MainActivity`). Captured live from the already-focused Home screen. **No rebuild, reinstall, or relaunch.** No save/confirm mutations. Sign Out was not tapped.

Physical size: **1080×2400**. List viewport: **185–2085**. Pill tab bar: **2085–2274**. Signed-in user: **Supreme King** (`ctocrm@outlook.com`). Monthly spend shown as **$211.95**.

Folder: `docs/reference/visual-baseline-2026-08-27/`  
Do not reuse `docs/test-screens/`.

---

## Captured screens

### Home (`app/(tabs)/index.tsx`)

| File | What was visible |
|------|------------------|
| [`01-home-top.png`](01-home-top.png) | Avatar, **Supreme King**, `+`, Monthly Spend **$211.95** / **09/24**, Upcoming empty (“No upcoming renewals yet.”), All Subscriptions + View all, orange **Scan mailbox for subscriptions**, Spotify card ($9.99 Monthly, brand icon), xAI clipped at tab bar. Home tab selected. |
| [`02-home-scrolled.png`](02-home-scrolled.png) | Same header content shifted up; **xAI** fully visible (sparse, `?`, This month, xAI mark). |
| [`03-home-scrolled-2.png`](03-home-scrolled-2.png) | Scan banner, Spotify, xAI, Linear ($8.00), acehardware ($8.00), second acehardware clipped. |
| [`04-home-scrolled-3.png`](04-home-scrolled-3.png) | Spotify through two acehardware cards plus **figma** ($6.00 Design) clipped. |
| [`05-home-scrolled-4.png`](05-home-scrolled-4.png) | Linear, two acehardware, figma, **Proton** ($9.99 Cloud), **Ace Hardware** clipped. |
| [`06-home-scrolled-5.png`](06-home-scrolled-5.png) | Two acehardware, figma, Proton, Ace Hardware, **notion** ($7.00 Productivity). Last unique Home list frame. |

Home list cards seen: Spotify, xAI, Linear, acehardware (×2), figma, Proton, Ace Hardware, notion.

### Home overlays / sheets (open → screenshot → dismiss, no save)

| File | What was visible |
|------|------------------|
| [`07-create.png`](07-create.png) | **New Subscription** sheet: icon `+`, Name / Price / Frequency (Monthly selected) / Category chips (Other selected), **Create Subscription**. Closed via **✕**. |
| [`08-user-settings.png`](08-user-settings.png) | **User Settings**: avatar, Supreme King, `ctocrm@outlook.com`, Edit, Change Password, Notifications + Upcoming Renewal Reminders toggle on, **Done**. |
| [`09-change-password.png`](09-change-password.png) | Native alert: “To change your password, please visit your account settings in the Clerk-powered authentication.” **OK**. Dismissed. |
| [`10-user-settings-edit.png`](10-user-settings-edit.png) | Inline edit: name **Supreme King**, first name **Dave**, Import Avatar / Remove, **Save Profile**. Closed via **Cancel** then **Done** (not saved). |
| [`11-spotify-overflow.png`](11-spotify-overflow.png) | Spotify `•••` sheet: View Stats, Edit, Mark as Paused, Mark as Canceled, Delete, Cancel. |
| [`12-edit-spotify.png`](12-edit-spotify.png) | **Edit Subscription** for spotify: logo, Name, Price 9.99, Monthly, Music, Plan / Payment Method placeholders, Next Renewal Date **2026-09-26**. Save Changes clipped. |
| [`13-edit-spotify-scrolled.png`](13-edit-spotify-scrolled.png) | Same form with **Save Changes** fully visible. Closed via **✕** (not saved). |
| [`14-spotify-stats.png`](14-spotify-stats.png) | Stats sheet: spotify, **30 days remaining**, billing cycle 0%, Next Renewal Sep 26 2026, $9.99/monthly, Total Spent $9.99, Started Aug 26 2026, Status Active, **Close**. |
| [`15-icon-picker.png`](15-icon-picker.png) | **Choose Icon** after long-press on Spotify icon: Show incorrect/broken, AI Upscale Quality Fast/Sharp, 11 icons available (Ace Hardware tiles with Wrong/Broken), Search for Icon Online, Use Default Icon. Closed via **X** (no icon applied). |
| [`16-spotify-expanded.png`](16-spotify-expanded.png) | Expanded Spotify card (teal): Payment **Not provided**. Extra rows clipped. |
| [`17-spotify-expanded-scrolled.png`](17-spotify-expanded-scrolled.png) | Expanded details: Payment, Category Music, Started 08/26/2026, Renewal 09/26/2026, Status Active. Collapsed by tapping the card. |
| [`18-scan-mailbox.png`](18-scan-mailbox.png) | Scan result alert: **Scan** / **No new subscriptions.** / **OK**. Dismissed. No import. |

### Subscriptions (`app/(tabs)/subscriptions.tsx`)

| File | What was visible |
|------|------------------|
| [`19-subscriptions-top.png`](19-subscriptions-top.png) | Title + `+`, Scan subscriptions: **Proton Mail · david@picksandshovels.app**, **Tuta · picksandshovels@tutamail.com** (Edit/Remove each), Add mailbox / Scan for subscriptions, search, All / Upcoming (0), Spotify + xAI. Subscriptions tab selected. |
| [`20-add-mailbox.png`](20-add-mailbox.png) | Provider list: Gmail, Google Workspace, Outlook, Office 365 / Microsoft 365, Zoho Mail, Fastmail, Proton Mail, Tuta, IMAP / IMAPS, **Cancel**. Closed via Cancel (no connect). |
| [`21-subscriptions-upcoming.png`](21-subscriptions-upcoming.png) | Upcoming (0) filter: “No upcoming subscriptions.” |
| [`22-subscriptions-scrolled.png`](22-subscriptions-scrolled.png) | Mid-list: xAI / Linear / acehardware with placeholder `+` icons (icons still loading on this frame), figma, Proton clipped. |
| [`23-subscriptions-scrolled-2.png`](23-subscriptions-scrolled-2.png) | acehardware, figma, Proton, Ace Hardware, notion, second figma clipped. |
| [`24-subscriptions-scrolled-3.png`](24-subscriptions-scrolled-3.png) | Proton Cloud, Ace Hardware, notion, figma $6, Proton Other $5, spotify Developer Tools $1, notion Yearly clipped. |
| [`25-subscriptions-scrolled-4.png`](25-subscriptions-scrolled-4.png) | notion $7, figma $6, Proton $5, spotify $1 Developer Tools, notion $12 Yearly, figma $1 clipped. |
| [`26-subscriptions-scrolled-5.png`](26-subscriptions-scrolled-5.png) | Proton $5, spotify $1, notion $12 Yearly, figma $1, Proton Cloud $9.99. |
| [`27-subscriptions-scrolled-6.png`](27-subscriptions-scrolled-6.png) | notion $12, figma $1, Proton Cloud, **Linode** $93 This month, **Linkedin** $0 free, **Openai** clipped. |
| [`28-subscriptions-scrolled-7.png`](28-subscriptions-scrolled-7.png) | Proton Cloud, Linode, Linkedin, Openai $0 free, Proton recurring **$359.76 Yearly**, Porkbun clipped. |
| [`29-subscriptions-scrolled-8.png`](29-subscriptions-scrolled-8.png) | Linkedin, Openai, Proton $359.76, **Porkbun** $47.74 This year, **Tuta** sparse `?`. |
| [`30-subscriptions-end.png`](30-subscriptions-end.png) | Same last unique frame as 29 (extra swipe did not reveal more cards). End of list. |

Subscriptions unique cards beyond Home: extra figma/Proton/spotify/notion rows, Linode, Linkedin, Openai, Proton $359.76, Porkbun, Tuta.

### Insights (`app/(tabs)/insights.tsx`)

Period chip **cycles** (This Month → Last 3 Months → Last 6 Months → Year). There is no dropdown overlay.

| File | What was visible |
|------|------------------|
| [`31-insights-top.png`](31-insights-top.png) | Insights, chip **This Month**, This month actuals **$211.95**, 21 Total Subs, top merchant Linode $93.00, by kind recurring $118.95 / sparse $93.00, Top merchants Linode / Proton / spotify. |
| [`32-insights-last-3-months.png`](32-insights-last-3-months.png) | Same layout, chip **Last 3 Months**. [`32-insights-period.png`](32-insights-period.png) is the same capture. |
| [`33-insights-last-6-months.png`](33-insights-last-6-months.png) | Chip **Last 6 Months**. [`33-insights-period-2.png`](33-insights-period-2.png) is the same capture. |
| [`34-insights-year.png`](34-insights-year.png) | Chip **Year**. [`34-insights-period-3.png`](34-insights-period-3.png) is the same capture. |
| [`35-insights-scrolled.png`](35-insights-scrolled.png) | Top merchants continued (extra Proton rows). Chart still below. |
| [`36-insights-chart.png`](36-insights-chart.png) | Chart labels Sep–Feb entering view. |
| [`37-insights-chart-end.png`](37-insights-chart-end.png) | **Monthly spend from mail** bar chart (Sep–Feb) plus bottom period chips This Month / Last 3 Months / Last 6 Months / Year. Last unique Insights frame. |

### Settings (`app/(tabs)/settings.tsx`) — Sign Out **not** tapped

| File | What was visible |
|------|------------------|
| [`38-settings-top.png`](38-settings-top.png) | Settings title, avatar, Supreme King, `ctocrm@outlook.com`, Account ID `user_3FbLt1KePHv1gn8…`, Joined 6/24/2026, Cloud Sync copy, Google Drive selected, OneDrive/Dropbox clipped. |
| [`39-settings-scrolled.png`](39-settings-scrolled.png) | Account + Cloud Sync providers through Dropbox; ownCloud/Nextcloud entering. |
| [`40-settings-scrolled-2.png`](40-settings-scrolled-2.png) | Full provider list (Google Drive ✓, OneDrive, Dropbox, ownCloud, Nextcloud) + **Connect**; Backup & Restore heading clipped. |
| [`41-settings-backup.png`](41-settings-backup.png) | Connect, **Backup & Restore**, Export Backup, encryption copy, Import Backup; Cache heading clipped. |
| [`42-settings-cache.png`](42-settings-cache.png) | Backup + **Cache & Crawl Data**: Clear Icon Cache **(11)**, Clear Spider / Crawl History **(148)**; email-scan / Sign Out clipped. |
| [`43-settings-end.png`](43-settings-end.png) | Backup, all three clear buttons (Icon Cache 11, Crawl History 148, Email Scan Cache **347**), **Sign Out** fully visible. Sign Out was **not** tapped. |
| [`44-settings-confirm-clear-icon-cache.png`](44-settings-confirm-clear-icon-cache.png) | Confirm sheet: **Clear Icon Cache** — “This removes all 11 cached icon(s), 293 crawl candidate(s) and 0 queued fetch(es)…” **Clear** / **Cancel**. Dismissed via **Cancel** (not cleared). |

---

## Skipped (by plan)

- Sign-in / sign-up / onboarding
- Conflict resolution / import flow (would pick a file)
- Proton captcha
- Stub route `app/subscriptions/[id].tsx` (not linked from live UI)
- Any save/confirm mutation (Create, Save Changes, Save Profile, Clear, Disconnect, Connect, Import, Export share, Mark as Paused/Canceled, Delete)
- **Sign Out**

---

## Unreachable / not a distinct page from this session

| Target | Why |
|--------|-----|
| Sign-in / sign-up / onboarding | Already signed in; reaching them requires Sign Out. |
| `app/subscriptions/[id].tsx` | Stub; no live navigator target from Home/Subscriptions cards (cards expand inline / open sheets). |
| ConflictResolutionModal | Only after Import Backup + conflicting file. Import not started. |
| Document picker / share sheet | Export Backup / Import Backup would mutate or leave the app. |
| Cloud Connect OAuth | Connect not tapped. |
| Proton captcha / mailbox login | Add mailbox cancelled; Scan returned “No new subscriptions.” |
| Mark as Paused / Canceled / Delete confirm | Overflow options exist; tapping them would mutate. Only the menu itself was captured. |
| Insights period dropdown overlay | Chip **cycles** in place; no overlay. All four periods captured. |
| Home “View all” | Routes to the Subscriptions tab (already captured). |

---

## Capture method

`emulator-ui-driving` loop: dump → one tap/swipe → `adb exec-out screencap` → vision assert. App was already on Home when capture started.




