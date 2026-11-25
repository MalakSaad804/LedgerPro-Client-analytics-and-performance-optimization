import { useMemo } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/react/daygrid';
import timeGridPlugin from '@fullcalendar/react/timegrid';
import listPlugin from '@fullcalendar/react/list';
import interactionPlugin from '@fullcalendar/react/interaction';
import classicThemePlugin from '@fullcalendar/react/themes/classic';
import '@fullcalendar/react/skeleton.css';
import '@fullcalendar/react/themes/classic/theme.css';
import '@fullcalendar/react/themes/classic/palette.css';
import { openBooking } from '../store/uiSlice';
import { fetchBookings } from '../store/bookingsSlice';
import { ErrorBox, Spinner } from '../components/ui';
import { STATUS } from '../utils';

export default function CalendarPage() {
  const dispatch = useDispatch();
  const { items, status, error } = useSelector((s) => s.bookings);

  // turn bookings into calendar events, coloured by status
  const events = useMemo(
    () =>
      items.map((b) => ({
        id: b._id,
        title: `${b.service?.name || 'Booking'} - ${b.customer?.name || ''}`,
        start: b.slotStart,
        end: b.slotEnd || undefined,
        backgroundColor: STATUS[b.status]?.color,
        borderColor: STATUS[b.status]?.color,
        classNames: b.status === 'cancelled' ? ['ev-cancelled'] : [],
      })),
    [items]
  );

  if (status === 'loading') return <Spinner label="Loading your calendar..." />;
  if (status === 'failed') return <ErrorBox message={error} onRetry={() => dispatch(fetchBookings())} />;

  return (
    <div>
      <h1>Calendar</h1>
      <div className="legend">
        {Object.entries(STATUS).map(([k, v]) => (
          <span key={k}><span className="dot" style={{ background: v.color }} /> {v.label}</span>
        ))}
      </div>
      <div className="card calendar-card">
        <FullCalendar
          plugins={[classicThemePlugin, dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
          initialView={window.innerWidth < 700 ? 'listWeek' : 'timeGridWeek'}
          headerToolbar={{
            left: 'prev,next today',
            center: 'title',
            right: 'dayGridMonth,timeGridWeek,timeGridDay,listWeek',
          }}
          events={events}
          eventClick={(info) => dispatch(openBooking(info.event.id))}
          slotMinTime="08:00:00"
          slotMaxTime="19:00:00"
          allDaySlot={false}
          nowIndicator
          height="auto"
          eventTimeFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
          noEventsText="No appointments in this period"
        />
      </div>
    </div>
  );
}
