// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';

// replace the real socket with a fake so tests need no server
const socketHandlers = {};
const fakeSocket = { on: vi.fn((ev, fn) => { socketHandlers[ev] = fn; }), disconnect: vi.fn() };
vi.mock('socket.io-client', () => ({ io: vi.fn(() => fakeSocket) }));
import { io } from 'socket.io-client';

import auth from './store/authSlice';
import bookings from './store/bookingsSlice';
import ui from './store/uiSlice';
import analytics from './store/analyticsSlice';
import CalendarPage from './pages/CalendarPage';
import App from './App';

// today at 10:00-11:00 local time: always inside the visible week and the 08:00-19:00 grid
const at = (h) => { const d = new Date(); d.setHours(h, 0, 0, 0); return d.toISOString(); };
const item = {
  _id: 'b1', status: 'confirmed',
  slotStart: at(10),
  slotEnd: at(11),
  service: { name: 'Tax Consultation' }, customer: { name: 'Sara', email: 's@x.com' }, staff: { name: 'Ayesha' },
};

const makeStore = (extra = {}) =>
  configureStore({
    reducer: { auth, bookings, ui, analytics },
    preloadedState: {
      auth: { user: { name: 'Ayesha', role: 'staff' }, status: 'idle', error: null, initializing: false },
      bookings: { items: [item], status: 'succeeded', error: null, lastSynced: 1 },
      ...extra,
    },
  });

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => cleanup()); // remove the previous test's page from the DOM

describe('Calendar page', () => {
  it('renders bookings as calendar events', async () => {
    render(<Provider store={makeStore()}><CalendarPage /></Provider>);
    await waitFor(() => expect(screen.getAllByText(/Tax Consultation/).length).toBeGreaterThan(0), { timeout: 4000 });
  });

  it('clicking an event asks the app to open that booking', async () => {
    const store = makeStore();
    render(<Provider store={store}><CalendarPage /></Provider>);
    const ev = await waitFor(() => screen.getAllByText(/Tax Consultation/)[0], { timeout: 4000 });
    fireEvent.click(ev);
    await new Promise((r) => setTimeout(r, 500)); // FullCalendar reports clicks a moment later
    expect(store.getState().ui.selectedBookingId).toBe('b1');
  });
});

describe('App wiring', () => {
  it('renders the BookingModal from App.jsx when a booking is selected', async () => {
    const store = makeStore({ ui: { toasts: [], selectedBookingId: 'b1', connection: 'live' } });
    render(<Provider store={store}><App /></Provider>);
    await waitFor(() => expect(screen.getByText('Edit booking')).toBeTruthy());
    expect(screen.getByText('Cancel booking')).toBeTruthy();
  });

  it('App.jsx starts the real-time connection and refreshes on booking:changed', async () => {
    const store = makeStore();
    render(<Provider store={store}><App /></Provider>);
    await waitFor(() => expect(io).toHaveBeenCalledTimes(1));
    expect(typeof socketHandlers['booking:changed']).toBe('function');
    socketHandlers['booking:changed']({ id: 'b1', action: 'created' });
    await waitFor(() => expect(store.getState().ui.toasts.some((t) => t.text === 'New booking received')).toBe(true));
  });
});
