import { useEffect } from 'react';
import { useDispatch } from 'react-redux';
import { io } from 'socket.io-client';
import { getToken } from '../api/client';
import { fetchBookings } from '../store/bookingsSlice';
import { refreshAnalytics } from '../store/analyticsSlice';
import { setConnection, toast } from '../store/uiSlice';

const MESSAGES = {
  created: 'New booking received',
  cancelled: 'A booking was cancelled',
  rescheduled: 'A booking was rescheduled',
  updated: 'A booking was updated',
};

// Keeps a live connection to the API while a staff member is logged in (enabled = true).
// When a booking changes anywhere (a customer books, another tab edits), the list
// refreshes by itself. Called once, from App.jsx.
export default function useRealtime(enabled) {
  const dispatch = useDispatch();

  useEffect(() => {
    if (!enabled) return undefined;
    dispatch(setConnection('connecting'));

    const url = import.meta.env.VITE_SOCKET_URL || 'http://localhost:5000';
    const socket = io(url, { auth: { token: getToken() } });

    socket.on('connect', () => {
      dispatch(setConnection('live'));
      dispatch(fetchBookings()); // catch up on anything missed while offline
    });
    socket.on('disconnect', () => dispatch(setConnection('offline')));
    socket.on('connect_error', () => dispatch(setConnection('offline')));
    socket.on('booking:changed', ({ action }) => {
      dispatch(fetchBookings());
      dispatch(refreshAnalytics()); // keeps the charts current too
      dispatch(toast(MESSAGES[action] || 'Bookings updated', 'info'));
    });

    return () => socket.disconnect();
  }, [dispatch, enabled]);
}
