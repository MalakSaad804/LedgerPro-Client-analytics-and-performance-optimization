# Benchmark results

Generated 2026-11-24 20:56 UTC by `npm run benchmark`.

- Machine: Intel(R) Xeon(R) Processor @ 2.10GHz, 1 cores, 4.2 GB RAM, Node v22.23.5
- MongoDB 8.3.7, Redis connected, 200,000 bookings (365 days back, 30 days ahead), 3 staff, 3 services
- Each query: 2 warm-up runs, then 7 timed runs; the table shows the **median** in milliseconds. Numbers on other machines will differ, the ratios should not.

## 1. Query time by index setup (median ms)

| Query | A: no indexes (only _id) | B: indexes from Tasks 1-3 | C: final indexes (Task 4) | Speed-up A to C |
|---|---:|---:|---:|---:|
| Staff dashboard list (1 staff, last 60 days, limit 1000) | 126 | 16.8 | 19.4 | 6.5x |
| Customer "my bookings" (1 customer) | 83.3 | 3.32 | 3.01 | 27.7x |
| Slot check: bookings of one day (booking page) | 105 | 0.95 | 1.03 | 101.8x |
| Analytics trends, 7 days, all staff (admin) | 151 | 158 | 60.8 | 2.5x |
| Analytics trends, 7 days, one staff member | 131 | 26.8 | 23.3 | 5.6x |
| Analytics trends, 90 days, one staff member | 255 | 232 | 192 | 1.3x |
| Analytics trends, 90 days, all staff (admin) | 551 | 596 | 605 | 0.9x |
| Analytics peak times, 90 days, all staff | 430 | 429 | 440 | 1.0x |
| Analytics staff utilization, 90 days | 619 | 659 | 549 | 1.1x |
| Analytics summary (KPIs), 90 days | 192 | 219 | 209 | 0.9x |

## 2. How MongoDB answered each query (from `explain("executionStats")`)

| Query | A: plan / docs read | B: plan / docs read | C: plan / docs read |
|---|---|---|---|
| Staff dashboard list (1 staff, last 60 days, limit 1000) | COLLSCAN / 200,000 | IXSCAN / 1,000 | IXSCAN / 1,000 |
| Customer "my bookings" (1 customer) | COLLSCAN / 200,000 | IXSCAN / 241 | IXSCAN / 241 |
| Slot check: bookings of one day (booking page) | COLLSCAN / 200,000 | IXSCAN (covered) / 0 | IXSCAN (covered) / 0 |
| Analytics trends, 7 days, all staff (admin) | COLLSCAN / 200,000 | COLLSCAN / 200,000 | IXSCAN (covered) / 0 |
| Analytics trends, 7 days, one staff member | COLLSCAN / 200,000 | IXSCAN / 1,449 | IXSCAN (covered) / 0 |
| Analytics trends, 90 days, one staff member | COLLSCAN / 200,000 | IXSCAN / 15,104 | IXSCAN (covered) / 0 |
| Analytics trends, 90 days, all staff (admin) | COLLSCAN / 200,000 | COLLSCAN / 200,000 | IXSCAN (covered) / 0 |
| Analytics peak times, 90 days, all staff | COLLSCAN / 200,000 | COLLSCAN / 200,000 | IXSCAN (covered) / 0 |
| Analytics staff utilization, 90 days | COLLSCAN / 200,000 | COLLSCAN / 200,000 | IXSCAN (covered) / 0 |
| Analytics summary (KPIs), 90 days | COLLSCAN / 200,000 | COLLSCAN / 200,000 | IXSCAN / 45,994 |

"covered" = the answer came from the index alone, so no documents were read.

## 3. MongoDB profiler: operations slower than 50 ms

**Setup A:** 10 slow operation(s)

| ms | Plan | Docs examined | Returned | Operation |
|---:|---|---:|---:|---|
| 557 | COLLSCAN | 200,000 | 3 | aggregate ($match > $group) |
| 555 | COLLSCAN | 200,000 | 65 | aggregate ($match > $group > $sort > $project) |
| 382 | COLLSCAN | 200,000 | 40 | aggregate ($match > $group) |
| 288 | COLLSCAN | 200,000 | 65 | aggregate ($match > $group > $sort > $project) |
| 204 | COLLSCAN | 200,000 | 6 | aggregate ($match > $group > $sort > $project) |
| 195 | COLLSCAN | 200,000 | 1 | aggregate ($match > $facet) |
| 144 | COLLSCAN | 200,000 | 6 | aggregate ($match > $group > $sort > $project) |
| 124 | COLLSCAN | 200,000 | 0 | find {"status":{"$ne":"cancelled"},"slotStart":{"$gte":"2026-11-21T00:00:00.000Z","$lt":"2026-1 |
| 106 | COLLSCAN | 200,000 | 101 | find {"staff":"6b05f8b6666355a0e2484e38","slotStart":{"$gte":"2026-09-25T20:51:05.646Z"}} |
| 103 | COLLSCAN | 200,000 | 101 | find {"customer":"6b05f8b6666355a0e2484e3e"} |

**Setup B:** 6 slow operation(s)

| ms | Plan | Docs examined | Returned | Operation |
|---:|---|---:|---:|---|
| 575 | COLLSCAN | 200,000 | 3 | aggregate ($match > $group) |
| 543 | COLLSCAN | 200,000 | 65 | aggregate ($match > $group > $sort > $project) |
| 401 | COLLSCAN | 200,000 | 40 | aggregate ($match > $group) |
| 247 | IXSCAN { staff: 1, slotStart: 1 } | 15,104 | 65 | aggregate ($match > $group > $sort > $project) |
| 203 | COLLSCAN | 200,000 | 1 | aggregate ($match > $facet) |
| 187 | COLLSCAN | 200,000 | 6 | aggregate ($match > $group > $sort > $project) |

**Setup C:** 6 slow operation(s)

| ms | Plan | Docs examined | Returned | Operation |
|---:|---|---:|---:|---|
| 715 | IXSCAN { slotStart: 1, status: 1, staff: 1, slotEnd: 1 } | 0 | 3 | aggregate ($match > $group) |
| 587 | IXSCAN { slotStart: 1, status: 1, staff: 1, slotEnd: 1 } | 0 | 65 | aggregate ($match > $group > $sort > $project) |
| 484 | IXSCAN { slotStart: 1, status: 1, staff: 1, slotEnd: 1 } | 0 | 40 | aggregate ($match > $group) |
| 255 | IXSCAN { slotStart: 1, status: 1, staff: 1, slotEnd: 1 } | 45,994 | 1 | aggregate ($match > $facet) |
| 197 | IXSCAN { staff: 1, slotStart: 1, status: 1, slotEnd: 1 } | 0 | 65 | aggregate ($match > $group > $sort > $project) |
| 60 | IXSCAN { slotStart: 1, status: 1, staff: 1, slotEnd: 1 } | 0 | 6 | aggregate ($match > $group > $sort > $project) |

## 4. Cost of the indexes on writes

| Setup | Microseconds per insert (30,000 inserts) |
|---|---:|
| A: no indexes (only _id) | 12.6 |
| B: indexes from Tasks 1-3 | 17.0 |
| C: final indexes (Task 4) | 26.2 |

## 5. Cache: miss vs hit

### Redis

Aggregation through the cache (final indexes, 90 days):

| Query | First call (miss) ms | Cached call (hit) ms | Faster |
|---|---:|---:|---:|
| trends | 634 | 0.134 | 4719x |
| peak | 449 | 0.117 | 3831x |
| utilization | 573 | 0.103 | 5546x |

Full HTTP request (token check, routing, JSON), median:

| Endpoint | No cache ms | Cached ms | Faster |
|---|---:|---:|---:|
| trends | 622 | 1.58 | 394.6x |
| peak-times | 463 | 1.41 | 328.5x |
| staff-utilization | 602 | 1.68 | 358.6x |
| summary | 214 | 1.36 | 157.1x |

### In-memory fallback

Aggregation through the cache (final indexes, 90 days):

| Query | First call (miss) ms | Cached call (hit) ms | Faster |
|---|---:|---:|---:|
| trends | 581 | 0.091 | 6402x |
| peak | 461 | 0.061 | 7558x |
| utilization | 535 | 0.052 | 10363x |

Full HTTP request (token check, routing, JSON), median:

| Endpoint | No cache ms | Cached ms | Faster |
|---|---:|---:|---:|
| trends | 605 | 1.39 | 434.0x |
| peak-times | 422 | 1.24 | 340.4x |
| staff-utilization | 523 | 1.18 | 441.6x |
| summary | 214 | 1.20 | 177.6x |
