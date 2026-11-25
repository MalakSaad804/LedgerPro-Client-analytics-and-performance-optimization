import { useMemo } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { openBooking } from '../store/uiSlice';
import { computeStats, computeUpcoming, fetchBookings } from '../store/bookingsSlice';
import StatusBadge from '../components/StatusBadge';
import { ErrorBox, Spinner } from '../components/ui';
import { fmtDateTime } from '../utils';

export default function Overview() {
  const dispatch = useDispatch();
  const { items, status, error } = useSelector((s) => s.bookings);
  const stats = useMemo(() => computeStats(items), [items]);
  const upcoming = useMemo(() => computeUpcoming(items).slice(0, 8), [items]);

  if (status === 'loading') return <Spinner label="Loading your bookings..." />;
  if (status === 'failed') return <ErrorBox message={error} onRetry={() => dispatch(fetchBookings())} />;

  const cards = [
    { label: "Today's appointments", value: stats.today, tone: 'blue' },
    { label: 'Upcoming', value: stats.upcoming, tone: 'green' },
    { label: 'Pending', value: stats.pending, tone: 'amber' },
    { label: 'Cancelled', value: stats.cancelled, tone: 'grey' },
  ];

  return (
    <div>
      <h1>Overview</h1>
      <div className="stats">
        {cards.map((c) => (
          <div key={c.label} className={`stat stat-${c.tone}`}>
            <div className="stat-value">{c.value}</div>
            <div className="muted">{c.label}</div>
          </div>
        ))}
      </div>

      <h2>Upcoming appointments</h2>
      {upcoming.length === 0 ? (
        <div className="card empty">No upcoming appointments. New bookings will appear here by themselves.</div>
      ) : (
        <ul className="list card">
          {upcoming.map((b) => (
            <li key={b._id}>
              <button className="row-btn" onClick={() => dispatch(openBooking(b._id))}>
                <div className="when">{fmtDateTime(b.slotStart)}</div>
                <div className="grow">
                  <strong>{b.service?.name}</strong>
                  <div className="muted">{b.customer?.name}</div>
                </div>
                <StatusBadge status={b.status} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
