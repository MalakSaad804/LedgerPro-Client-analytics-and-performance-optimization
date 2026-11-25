# LedgerPro API

Secure booking backend for **LedgerPro Accountants** — clients book tax-consultation and audit-review slots, staff manage services and capacity. Built with Node.js, Express 5, MongoDB (Mongoose), JWT and bcrypt.

## Setup

```bash
npm install
cp .env.example .env      # then edit values
npm run seed              # creates the first admin
npm run dev               # http://localhost:5000
```

## Project structure

```
src/
  config/db.js            MongoDB connection
  models/                 User, Service, Booking (schemas + indexes)
  middleware/             auth (JWT), role (RBAC), error (central handler)
  controllers/            request logic
  routes/                 route definitions
  app.js / server.js      app setup / entry point
scripts/seed.js           creates admin account
```

## Roles

| Role | How created | Access |
|------|-------------|--------|
| customer | public `/register` | own bookings |
| staff | created by admin | manage services, view all bookings |
| admin | `npm run seed` | everything staff can + create staff |

## API endpoints

Protected routes need header `Authorization: Bearer <token>`.

| Method | Endpoint | Access | Description |
|--------|----------|--------|-------------|
| GET | /api/health | public | Health check |
| POST | /api/auth/register | public | Register a customer. Body: `name, email, password (8+)` |
| POST | /api/auth/login | public | Returns `{ token, role, name }` |
| GET | /api/auth/me | any logged-in | Current user profile |
| POST | /api/auth/staff | admin | Create a staff account |
| GET | /api/services | public | List active services |
| POST | /api/services | staff, admin | Create service. Body: `name, durationMins, dailyCapacity, description` |
| PATCH | /api/services/:id | staff, admin | Update service fields |
| DELETE | /api/services/:id | staff, admin | Deactivate service (soft delete) |
| GET | /api/services/:id/slots?date=YYYY-MM-DD | logged-in | Slots for a service on a date, each with `available` true/false |
| GET | /api/customer/bookings | customer | Own bookings only |
| POST | /api/customer/bookings | customer | Create booking. Body: `serviceId, slotStart (ISO), notes` |
| PATCH | /api/customer/bookings/:id/cancel | customer | Cancel own booking |
| GET | /api/staff/bookings?status=&from=&to= | staff, admin | **Staff: only bookings assigned to them.** Admin: all |
| GET | /api/staff/bookings/:id | staff, admin | One booking (404 if not the staff member's own) |
| PATCH | /api/staff/bookings/:id | staff, admin | Change `status`, `staffNotes` or reschedule with `slotStart` (own bookings only) |
| GET | /api/staff/bookings/:id/slots?date= | staff, admin | Free times in that staff member's own schedule, for moving a booking |
| GET | /api/staff/availability | staff | Own weekly working hours |
| PUT | /api/staff/availability | staff | Replace own hours. Body: `{ days: [{ dayOfWeek, startTime, endTime }] }` |

### Example

```bash
curl -X POST localhost:5000/api/auth/login -H "Content-Type: application/json" \
  -d '{"email":"admin@ledgerpro.com","password":"Admin@12345"}'
```

## Error codes

All errors return `{ "error": "CODE", "message": "..." }`.

| HTTP | Code | Meaning |
|------|------|---------|
| 400 | VALIDATION_ERROR | Missing or invalid fields |
| 400 | INVALID_ID | Malformed MongoDB id |
| 400 | BAD_JSON | Malformed JSON body |
| 401 | NO_TOKEN | Authorization header missing |
| 401 | INVALID_TOKEN | Token tampered or malformed |
| 401 | TOKEN_EXPIRED | Token expired, log in again |
| 401 | INVALID_CREDENTIALS | Wrong email or password |
| 403 | FORBIDDEN | Role not allowed for this route |
| 404 | NOT_FOUND | Resource or route does not exist |
| 400 | INVALID_SLOT | Time is not offered for that service |
| 409 | SLOT_TAKEN | Slot was booked by someone else, the day is full, or the staff member is busy then |
| 409 | BOOKING_CLOSED | Booking is already cancelled or completed and cannot be changed |
| 409 | EMAIL_EXISTS / DUPLICATE | Unique value already used |
| 500 | SERVER_ERROR | Unexpected error (details only in server logs) |

## Data model

- **User** — name, email (unique), password (hash, `select: false`), role
- **Service** — name, durationMins, dailyCapacity, isActive, createdBy → User
- **Booking** — customer → User, service → Service, **staff → User (assigned accountant)**, slotStart, slotEnd, status (`pending`, `confirmed`, `completed`, `cancelled`), notes (customer), staffNotes (staff)
- **Availability** — staff → User, dayOfWeek (0-6), startTime, endTime (one window per staff per weekday)

Indexes:
- `User.email` unique, `User.role`
- `Service {isActive, name}` for the public listing
- `Booking {customer, slotStart:-1}` for "my bookings"
- `Booking {service, slotStart, status}` for capacity checks
- `Booking {staff, slotStart}` for the staff dashboard and clash checks
- `Availability {staff, dayOfWeek}` unique, and `{dayOfWeek}` for slot generation

## Architectural decision log

**ADR-1: Separate User, Service and Booking collections, linked by references.**
Services and users change independently of bookings, and bookings grow fastest. References avoid duplicating data. Trade-off: reads need `populate()` (extra query), accepted because lists are small and indexed.

**ADR-2: Stateless JWT instead of server sessions.**
The React frontend and API can be deployed separately on free hosts, and no session store is needed. Trade-off: a token cannot be revoked before it expires, so tokens are short-lived (1 day). Refresh tokens can be added later.

**ADR-3: bcrypt with cost 12 for passwords.**
Slow by design to resist brute force. Trade-off: about 250 ms per hash, acceptable for login and register.

**ADR-4: Role comes from the database and token, never from request bodies.**
Public registration always creates a `customer`. Staff are created only by an admin, and the first admin comes from a seed script. This blocks privilege escalation through signup.

**ADR-5: Role-based middleware (`protect` then `allow(...roles)`).**
Authorization lives in one reusable place instead of `if` checks in every controller. Trade-off: roles are coarse; fine-grained ownership checks (e.g. a customer cancelling only their own booking) are done in controllers.

**ADR-6: Soft delete for services.**
Deactivating (`isActive: false`) keeps old bookings pointing at a valid service.

**ADR-7: Central error handler with stable error codes.**
The frontend can branch on `error` codes, and internal errors are not leaked to clients.

**ADR-8: Slots are computed on request from staff availability, not stored.**
Staff save weekly working hours; the API cuts them into service-length slots and subtracts existing bookings. Nothing to keep in sync when hours change. Trade-off: a little compute per request, fine at this scale. A slot's capacity equals the number of staff working at that time.

**ADR-9: The server re-validates the slot when booking.**
The client only sends a start time; the API checks it is a real, free, future slot. Trade-off: two simultaneous requests could still both pass the check. A transaction or unique constraint would close that gap (future work).

**ADR-10: Fixed business time zone (`BUSINESS_TZ_OFFSET_MIN`).**
Working hours are written in business time so labels like "09:00" are the same on every device.

**ADR-11: Data ownership is enforced in the API, not in the UI.**
Every booking has a `staff` field. All staff booking queries go through one helper, `ownerFilter`, which adds `{ staff: <logged-in id> }` to the query. The id comes from the verified JWT, never from the request. A staff member asking for someone else's booking gets `404 NOT_FOUND` (not 403), so the API does not even confirm that the booking exists. Admins (managers) skip the filter. Trade-off: if staff ever need shared bookings, the filter must become a team check.

**ADR-12: The API assigns the staff member when a customer books.**
Among staff who work at that time and have no clash, the one with the fewest bookings that day is chosen. Trade-off: customers cannot pick their accountant (can be added later).

**ADR-13: Real-time updates with Socket.IO rooms; events carry no booking data.**
Staff connect with their JWT (checked at connection) and join a private room `staff:<id>`. When a booking is created, cancelled or edited, only that room gets `{ id, action }`. The dashboard then re-fetches through the protected REST API, so ownership rules apply to every read. Trade-off: one extra request per event, accepted for safety and simplicity.

**ADR-14: Closed bookings are final.**
Cancelled and completed bookings return `409 BOOKING_CLOSED` if edited, which keeps history trustworthy.


## Analytics API

Staff see only their own numbers, admins see everyone (same ownership rule as the booking API). Query parameters: `from` and `to` (dates like `2026-11-24`, default: 30 days back to 14 days ahead, max 400 days) and, for trends, `interval` = `day`, `week` or `month`.

| Method | Endpoint | What it returns |
|--------|----------|-----------------|
| GET | /api/analytics/summary | Totals, cancellation rate, completed, average per day, busiest day, top services |
| GET | /api/analytics/trends | Bookings per day / week / month, split into booked and cancelled |
| GET | /api/analytics/peak-times | Weekday x hour grid, bookings per hour and per weekday, top 5 busiest slots |
| GET | /api/analytics/staff-utilization | Per staff member: bookings, booked minutes, working minutes, utilization % |

Responses carry `X-Cache: HIT | MISS | BYPASS` and `Server-Timing`. Send `Cache-Control: no-cache` to skip the cache.

How the numbers are calculated (all in `src/services/analytics.service.js`, with MongoDB aggregation):

- **Trends:** `$match` (date range, owner) then `$group` by `$dateTrunc` in the office time zone, with `$cond` counters for booked, completed and cancelled. Days without bookings are filled with zero in code.
- **Peak times:** `$group` by `$dayOfWeek` and `$hour` (office time zone) of `slotStart`, cancelled bookings excluded.
- **Staff utilization:** `$group` by staff summing booked minutes (`slotEnd - slotStart`), divided by the minutes the staff member works in that period (their weekly hours x the weekdays in the range). Cancelled bookings do not use up time.
- **Summary:** one `$facet` stage that computes status counts, top services (with `$lookup`) and the busiest day in a single pass.

Run `npm test` to check every figure against a small data set worked out by hand (needs a local MongoDB; 9 tests, also with Redis).

## Performance: findings and improvements

All numbers below were measured with `npm run benchmark` on: 200,000 bookings (365 days back, 30 days ahead), MongoDB 8.3.7, Redis, Node 22, a small **1 CPU core / 4 GB** virtual machine. Your numbers will differ; the ratios are what matter. Full report: [docs/benchmark-results.md](docs/benchmark-results.md).

### How slow queries were found

1. **MongoDB profiler** (`db.setProfilingLevel(1, { slowms: 50 })`, then read `db.system.profile`). With no indexes it flagged 10 operations over 50 ms. Every one was a `COLLSCAN` reading all 200,000 documents (table 3 in the full report).
2. **`explain("executionStats")`** on each query: plan type, documents examined, time.
3. **Request timing in the API:** every response has a `Server-Timing` header, and requests over 300 ms are printed as `SLOW REQUEST` in the server log.

### Improvement 1: indexes (the problem was a full scan on every lookup)

Median time in milliseconds (A = no indexes, B = indexes from Tasks 1-3, C = final indexes):

| Query | A: no indexes | B: Tasks 1-3 indexes | C: final indexes | A to C |
|---|---:|---:|---:|---:|
| Staff dashboard list (1 staff, last 60 days, max 1000) | 126 | 16.8 | 19.4 | 6.5x |
| Customer "my bookings" | 83.3 | 3.32 | 3.01 | 27.7x |
| Slot check for one day (booking page) | 105 | 0.95 | 1.03 | 101.8x |
| Trends, 7 days, one staff member | 131 | 26.8 | 23.3 | 5.6x |
| Trends, 7 days, all staff | 151 | 158 | 60.8 | 2.5x |
| Trends, 90 days, one staff member | 255 | 232 | 192 | 1.3x |
| Trends, 90 days, all staff | 551 | 596 | 605 | 0.9x |
| Peak times, 90 days | 430 | 429 | 440 | 1.0x |
| Staff utilization, 90 days | 619 | 659 | 549 | 1.1x |
| Summary KPIs, 90 days | 192 | 219 | 209 | 0.9x |

Documents MongoDB had to read:

| Query | Documents read, A | B | C |
|---|---:|---:|---:|
| Staff dashboard list (1 staff, last 60 days, max 1000) | 200,000 | 1,000 | 1,000 |
| Customer "my bookings" | 200,000 | 241 | 241 |
| Slot check for one day (booking page) | 200,000 | 0 | 0 |
| Trends, 7 days, one staff member | 200,000 | 1,449 | 0 |
| Trends, 7 days, all staff | 200,000 | 200,000 | 0 |
| Trends, 90 days, one staff member | 200,000 | 15,104 | 0 |
| Trends, 90 days, all staff | 200,000 | 200,000 | 0 |

What changed:

- `{ customer, slotStart }`, `{ service, slotStart, status }` and `{ staff, slotStart }` (Tasks 1-3) turned the customer, staff and booking-page lookups from scans of 200,000 documents into reads of a few hundred or none.
- Task 4 widened the staff index to `{ staff, slotStart, status, slotEnd }` (it replaces the old `{ staff, slotStart }`, which is a prefix of it) and added `{ slotStart, status, staff, slotEnd }`. These two hold every field the analytics need, so they are answered **from the index alone ("covered", 0 documents read)**. For a 7-day window this made the admin trends **2.5x** faster and the single-staff trends **5.6x** faster.
- **The staff dashboard list** used to return a staff member's whole history. It now returns the last 60 days by default and at most 1,000 bookings (`?from=`, `?to=`, `?limit=` to change this). This keeps the response size bounded as bookings pile up.

Cost of the indexes: inserting costs about 13 µs per booking with no indexes, 17 µs with the Tasks 1-3 indexes and 26 µs with the final ones. Bookings are rare compared with reads, so +9 µs per booking is a fair price. The five indexes take about 11 MB next to 36 MB of data.

### What indexes did NOT fix (and why we added a cache)

For long ranges (90 days, about 46,000 bookings) the analytics queries stay at roughly 200-600 ms, **even when the index answers them without reading any document** (admin trends 90 days: 551 ms without index, 605 ms with it). The time is spent grouping tens of thousands of entries, not finding them, so a better index cannot remove it. This is a useful result of the profiling: it shows where an index stops helping.

### Improvement 2: caching with Redis

Analytics results are cached for 5 minutes (`src/utils/cache.js`), and the public services list for 60 seconds. HTTP requests measured end to end (token check, routing, JSON), median:

| Endpoint (90-day range) | No cache (ms) | Redis cache hit (ms) | Faster |
|---|---:|---:|---:|
| trends | 622 | 1.6 | 395x |
| peak-times | 463 | 1.4 | 328x |
| staff-utilization | 602 | 1.7 | 359x |
| summary | 214 | 1.4 | 157x |

Design points:

- **Redis when `REDIS_URL` is set, otherwise a small in-memory cache**, so the API still works without Redis (the benchmark measures both).
- **Always fresh after a change:** keys contain a version number (`analytics:<version>:<key>`). Creating, cancelling or editing a booking, or changing working hours, increments the version, which makes every old entry unreachable at once. `npm test` proves a new booking shows up immediately.
- **Per-person keys:** the key contains the staff id (or `all` for admins), so a staff member can never receive the admin's numbers from the cache.
- **Redis down:** commands fail fast and the API falls back to the in-memory cache.

### Remaining limits and next steps

- Uncached 90-day analytics still take about 0.2-0.6 s on this small machine. A **daily summary collection** (updated when a booking changes) would make them fast even on a cold cache.
- An in-memory cache is per server process; use Redis when running more than one server.
- MongoDB Atlas free clusters (M0) do not allow the profiler. The benchmark still works there through `explain`; use a local MongoDB to see the profiler section.

### Run the benchmark yourself

```bash
npm run benchmark                         # needs a local MongoDB; builds its own ledgerpro_bench database
REDIS_URL=redis://127.0.0.1:6379 npm run benchmark   # also measures the Redis cache
BENCH_BOOKINGS=50000 npm run benchmark    # smaller and faster
```

It never touches your real database (the benchmark database name must contain "bench") and writes `docs/benchmark-results.md` and `.json`.

### Demo data

`npm run seed` then `npm run seed:demo` adds about 500 demo bookings (60 days back, 14 ahead) so the charts are not empty.

## Real-time events

Socket.IO on the same port. Connect with `auth: { token }` (staff or admin only). Event `booking:changed` with `{ id, action }`, where action is `created`, `cancelled`, `rescheduled` or `updated`.

## Demo accounts (`npm run seed`)

- Admin: `admin@ledgerpro.com` / `Admin@12345`
- Staff 1: `staff@ledgerpro.com` / `Staff@12345` (Mon-Fri 09:00-17:00)
- Staff 2: `staff2@ledgerpro.com` / `Staff@12345` (Mon-Fri 10:00-18:00)

**ADR-15: Analytics are calculated by MongoDB aggregation, not in Node.**
Only the small result (a few dozen rows) travels to the server. Dates are grouped in the office time zone inside the pipeline. Trade-off: heavy pipelines cost database CPU, which is why they are cached.

**ADR-16: Cache with version numbers instead of deleting keys.**
One `INCR` invalidates everything for that area, no key scanning. Trade-off: old entries stay in Redis until their 5-minute expiry.

**ADR-17: Keep the analytics indexes even though they do not speed up long ranges.**
They cut short-range queries by 2.5x-5.6x and make them "covered". Trade-off: about +9 µs per insert and 5 MB more disk; accepted because bookings are written rarely.

## Known limitations (planned for later tasks)

- Two customers booking the same slot at the exact same moment could both pass the check (needs a transaction or unique index)
- Daily summary collection for instant analytics on a cold cache
- Rate limiting, helmet, input sanitization (security hardening task)
- Pagination and caching (performance task)
