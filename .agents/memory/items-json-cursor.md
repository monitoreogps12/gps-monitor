---
name: items_json cursor behavior
description: How the GPS platform's items_json endpoint works as a session cursor and the workaround for offline-device last-seen times.
---

## Rule
`/objects/items_json?time=0` is a **session cursor**, NOT a full snapshot. It returns only devices that have been active in the last few minutes (~27 of 500+ devices). To get all devices active in the past N days, pass a Unix timestamp: `time = Math.floor((Date.now() - N_days * 86400 * 1000) / 1000)`.

**Why:** The platform's JavaScript polls `items_json` continuously during a browser session, accumulating all device updates over time. Our server session starts fresh and only sees the initial snapshot. Using a 7-day lookback captures all recently-offline devices (e.g., CAJA SECA id=1059, offline 20h, correctly shows "09-08-2026 01:12:47 PM").

**How to apply:** In `fetchAllDeviceLastSeenTimes()` (gps-service.ts), use `sevenDaysAgoSec` as the `time` parameter instead of `0`. The response includes both `time` (formatted GPS string like "DD-MM-YYYY HH:MM:SS AM") and `timestamp`/`acktimestamp` (Unix seconds). Platform JS logic: `Math.max(timestamp, acktimestamp)`.

## Excel Export as Better Source
The platform's "ObjectListLookupTable" Excel export (downloaded from the platform UI) has "Ultima conexión" for ALL 476 devices. Parsed to JSON at `artifacts/api-server/src/data/device-last-seen.json` with `byImei` and `byPlate` indexes. This is now the PRIMARY source in `fetchOfflineReport`, covering 174/217 offline devices. Remaining 43 have no matching IMEI/plate in the Excel.

The Excel was generated at 2026-08-10T14:07:16. To refresh: user re-downloads from platform UI and re-uploads; the JSON file must be regenerated. Finding the platform's export URL would automate this.

## Devices still showing installationDate as lastConnection
128 devices (of ~218 offline) show installationDate as lastConnection — these are legitimately disconnected for 7+ days (some 1800-1900 days). This is correct behavior; no GPS data is available for them in the 7-day window.

## Fields in items_json response per item
`id, name, image, tail, tail_color, icon_color, icon_colors, active, group_id, online, lat, lng, speed, course, altitude, time, timestamp, acktimestamp, engine_status, inaccuracy, moved_timestamp, stop_duration_sec, total_distance, icon`

## fields NOT available
- `/objects/items?full=true` — has sensors but NO `time` field for any device
- `/objects/list/data` (DataTables) — has name/plate/imei/sim/model/install/expiry but NO `time`
