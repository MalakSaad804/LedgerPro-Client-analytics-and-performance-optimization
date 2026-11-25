import { useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { cleared, restoreSession } from './store/authSlice';
import { closeBooking } from './store/uiSlice';
import useRealtime from './hooks/useRealtime';
import BookingModal from './components/BookingModal';
import DashboardLayout from './components/DashboardLayout';
import { Spinner } from './components/ui';
import Login from './pages/Login';
import Overview from './pages/Overview';
import CalendarPage from './pages/CalendarPage';
import BookingsPage from './pages/BookingsPage';
import AnalyticsPage from './pages/AnalyticsPage';

function RequireAuth({ children }) {
  const { user, initializing } = useSelector((s) => s.auth);
  if (initializing) return <Spinner label="Checking your session..." />;
  return user ? children : <Navigate to="/login" replace />;
}

// The ONE place the booking window (view / edit / cancel) is rendered.
// Overview, Calendar and All bookings just dispatch openBooking(id).
function SelectedBookingModal() {
  const dispatch = useDispatch();
  const booking = useSelector((s) => s.bookings.items.find((b) => b._id === s.ui.selectedBookingId));
  if (!booking) return null;
  return (
    <BookingModal
      key={booking._id + booking.updatedAt}
      booking={booking}
      onClose={() => dispatch(closeBooking())}
    />
  );
}

export default function App() {
  const dispatch = useDispatch();
  const user = useSelector((s) => s.auth.user);

  // live updates: connects when a staff member is logged in, disconnects on logout
  useRealtime(Boolean(user));

  useEffect(() => {
    dispatch(restoreSession());
    const onExpired = () => dispatch(cleared());
    window.addEventListener('auth:expired', onExpired);
    return () => window.removeEventListener('auth:expired', onExpired);
  }, [dispatch]);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route element={<RequireAuth><DashboardLayout /></RequireAuth>}>
          <Route path="/" element={<Overview />} />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/bookings" element={<BookingsPage />} />
          <Route path="/analytics" element={<AnalyticsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      {user && <SelectedBookingModal />}
    </BrowserRouter>
  );
}
