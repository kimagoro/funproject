# Scalability Improvements for 8,000 Events/Day

## Problem Identified
- **Current Architecture**: Loading ALL events into browser memory via `/api/events/all`
- **Scale Impact**: With 8,000 events/day:
  - 30 days = 240,000 events
  - JSON payload = 120-200 MB
  - Browser memory crash/slowdown
  - Poor user experience

## Solution Implemented

### 1. Database Indexes (src/shared/database.ts)
Added 4 performance indexes to speed up queries:
```sql
CREATE INDEX idx_events_timestamp ON events(timestamp DESC)
CREATE INDEX idx_events_trdate ON events(trdate DESC)
CREATE INDEX idx_events_devname ON events(devname)
CREATE INDEX idx_events_staffno ON events(staffno)
```

### 2. New Database Methods (src/shared/database.ts)
```typescript
getEventsByDateRange(fromTimestamp?, toTimestamp?, limit?): Event[]
  - Efficiently query events within a specific date range
  - Optional limit to prevent massive result sets

getEventsFromLastDays(days: number = 7): Event[]
  - Quick retrieval of recent events
  - Default 7 days for performance
```

### 3. Server-Side Filtering (src/web-ui/index.ts)
Modified `/api/events/all` endpoint to accept query parameters:
- `?fromDate=YYYY-MM-DDTHH:mm` - Filter from this date/time
- `?toDate=YYYY-MM-DDTHH:mm` - Filter to this date/time
- `?days=7` - Get last N days

**Default Behavior**: Returns last 7 days (~56,000 events max)

### 4. Client-Side Updates (src/web-ui/index.ts)
Updated `loadEvents()` function:
- Check if date filters are active
- Build appropriate query string
- Default to `?days=7` for performance
- Full support for custom date ranges

## Performance Expectations

### Before (Loading ALL events)
- 30 days: ~240k events, 120-200 MB JSON
- Browser: Memory issues, slow rendering
- Load time: 10-30 seconds

### After (7-day default window)
- 7 days: ~56k events, 28-35 MB JSON
- Browser: Manageable memory, fast rendering
- Load time: 1-3 seconds

## Database Performance
SQLite with indexes can easily handle:
- ✅ Millions of events
- ✅ Fast date range queries (< 100ms)
- ✅ Device/staff filtering (< 50ms)

## User Experience
1. Dashboard loads instantly (last 7 days)
2. Date range filters for historical analysis
3. WebSocket provides real-time updates
4. Pagination keeps UI responsive

## Future Enhancements
- Add UI indicator: "Showing last 7 days (X events)"
- "Load All" button with warning
- Infinite scroll for large date ranges
- Event count by date chart
- Automatic archival (> 90 days)

## Testing Checklist
- [ ] Dashboard loads < 3 seconds
- [ ] Console shows: "Fetched X events from last 7 days (default)"
- [ ] Date range selection triggers server-side filtering
- [ ] Filters work across all pages
- [ ] WebSocket updates work instantly
- [ ] Performance stable with 8k events/day

## Deployment
```powershell
npm run build
docker-compose up -d --build
```

## Monitoring
- Check browser DevTools → Network tab for API response sizes
- Check Console for fetch logs
- Monitor container logs: `docker-compose logs -f`
- Database size: `ls -lh ./data/data.db`
