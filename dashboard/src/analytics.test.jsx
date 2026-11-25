// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';

// jsdom has no <canvas>, so the chart components are replaced by simple boxes that show their data
vi.mock('react-chartjs-2', () => ({
  Bar: ({ data }) => <div data-testid="bar-chart">{JSON.stringify(data.datasets.map((d) => d.data))}</div>,
}));
vi.mock('socket.io-client', () => ({ io: vi.fn(() => ({ on: vi.fn(), disconnect: vi.fn() })) }));
vi.mock('./api/client', async () => {
  const get = vi.fn();
  return { default: { get, post: vi.fn(), patch: vi.fn(), interceptors: {} }, getToken: () => 'tok', setToken: vi.fn(), errorMessage: (e) => e.message };
});
import api from './api/client';

import auth from './store/authSlice';
import bookings from './store/bookingsSlice';
import ui from './store/uiSlice';
import analytics, { fetchAnalytics, refreshAnalytics } from './store/analyticsSlice';
import AnalyticsPage from './pages/AnalyticsPage';
import App from './App';

const grid = Array.from({ length: 7 }, () => Array(24).fill(0));
grid[1][10] = 12; grid[3][14] = 5; // Monday 10:00 is the peak
const byHour = Array(24).fill(0); byHour[10] = 12; byHour[14] = 5;
const byWeekday = Array(7).fill(0); byWeekday[1] = 12; byWeekday[3] = 5;

const responses = {
  '/analytics/summary': { range: {}, total: 20, active: 17, cancelled: 3, completed: 9, cancellationRate: 0.15, avgPerDay: 1.5, busiestDay: { date: '2026-11-02', count: 6 }, topServices: [{ name: 'Tax Consultation', count: 10 }] },
  '/analytics/trends': { interval: 'day', points: [{ period: '2026-11-01', booked: 3, completed: 1, cancelled: 0 }, { period: '2026-11-02', booked: 6, completed: 2, cancelled: 1 }] },
  '/analytics/peak-times': { grid, byHour, byWeekday, topSlots: [{ weekday: 1, hour: 10, count: 12 }, { weekday: 3, hour: 14, count: 5 }], total: 17 },
  '/analytics/staff-utilization': { scope: 'all', staff: [
    { staffId: 's1', name: 'Bilal Ahmed', bookings: 7, completed: 3, cancelled: 1, bookedMinutes: 420, availableMinutes: 960, utilization: 0.4375 },
    { staffId: 's2', name: 'Ayesha Khan', bookings: 10, completed: 6, cancelled: 2, bookedMinutes: 600, availableMinutes: 1920, utilization: 0.3125 },
  ] },
};

const makeStore = (preloaded = {}) =>
  configureStore({
    reducer: { auth, bookings, ui, analytics },
    preloadedState: { auth: { user: { name: 'Admin', role: 'admin' }, status: 'idle', error: null, initializing: false }, ...preloaded },
  });

beforeEach(() => {
  vi.clearAllMocks();
  api.get.mockImplementation((url) => Promise.resolve({ data: responses[url], headers: { 'x-cache': url.includes('trends') ? 'HIT' : 'MISS' } }));
});
afterEach(() => cleanup());

describe('analytics store', () => {
  it('loads all four endpoints in parallel and counts cached ones', async () => {
    const store = makeStore();
    await store.dispatch(fetchAnalytics({ from: '2026-11-01', to: '2026-11-30', interval: 'day' }));
    expect(api.get).toHaveBeenCalledTimes(4);
    expect(api.get).toHaveBeenCalledWith('/analytics/trends', { params: { from: '2026-11-01', to: '2026-11-30', interval: 'day' } });
    expect(store.getState().analytics.data.cached).toBe(1);
    expect(store.getState().analytics.status).toBe('succeeded');
  });

  it('refreshAnalytics reloads with the last settings, and does nothing before the first load', async () => {
    const store = makeStore();
    store.dispatch(refreshAnalytics());
    expect(api.get).not.toHaveBeenCalled();
    await store.dispatch(fetchAnalytics({ from: '2026-11-01', to: '2026-11-30', interval: 'week' }));
    api.get.mockClear();
    store.dispatch(refreshAnalytics());
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(4));
    expect(api.get).toHaveBeenCalledWith('/analytics/trends', { params: expect.objectContaining({ interval: 'week' }) });
  });

  it('keeps the old charts when a refresh fails', async () => {
    const store = makeStore();
    await store.dispatch(fetchAnalytics({ from: 'a', to: 'b', interval: 'day' }));
    api.get.mockRejectedValue(new Error('Cannot reach the server.'));
    await store.dispatch(fetchAnalytics({ from: 'a', to: 'b', interval: 'day' }));
    const s = store.getState().analytics;
    expect(s.data).not.toBeNull();
    expect(s.status).toBe('succeeded');
    expect(s.error).toBe('Cannot reach the server.');
  });
});

describe('Analytics page', () => {
  it('shows KPIs, booking trends, peak times and staff utilization', async () => {
    render(<Provider store={makeStore()}><AnalyticsPage /></Provider>);
    await waitFor(() => expect(screen.getByTestId('kpis')).toBeTruthy());
    expect(screen.getByTestId('kpis').textContent).toContain('17');       // bookings
    expect(screen.getByTestId('kpis').textContent).toContain('15.0%');    // cancellation rate
    expect(screen.getByText(/Tax Consultation \(10\)/)).toBeTruthy();      // most booked service

    // trends: stacked bars with booked and cancelled per day
    const charts = screen.getAllByTestId('bar-chart').map((c) => c.textContent);
    expect(charts.some((t) => t === '[[3,6],[0,1]]')).toBe(true);

    // peak times identified
    expect(screen.getByTestId('peak-insight').textContent).toContain('10:00');
    expect(screen.getByTestId('peak-insight').textContent).toContain('Monday');
    expect(screen.getByTestId('top-slots').textContent).toContain('Monday 10:00');

    // staff utilization: both staff with percentages, highest first
    const rows = screen.getByTestId('util-table').querySelectorAll('tbody tr');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('Bilal Ahmed');
    expect(rows[0].textContent).toContain('43.8%');
    expect(rows[1].textContent).toContain('31.3%');
  });

  it('shows an error with a retry button when the API fails', async () => {
    api.get.mockRejectedValue(new Error('Cannot reach the server.'));
    render(<Provider store={makeStore()}><AnalyticsPage /></Provider>);
    await waitFor(() => expect(screen.getByText('Cannot reach the server.')).toBeTruthy());
    expect(screen.getByText('Try again')).toBeTruthy();
  });

  it('tells staff that they only see their own numbers', async () => {
    responses['/analytics/staff-utilization'] = { scope: 'own', staff: [responses['/analytics/staff-utilization'].staff[1]] };
    const store = makeStore({ auth: { user: { name: 'Ayesha', role: 'staff' }, status: 'idle', error: null, initializing: false } });
    render(<Provider store={store}><AnalyticsPage /></Provider>);
    await waitFor(() => expect(screen.getByText('You only see your own numbers.')).toBeTruthy());
    expect(screen.getAllByText(/Your own bookings only/).length).toBeGreaterThan(0);
  });
});

describe('App wiring', () => {
  it('serves the analytics page at /analytics and has a navigation link', async () => {
    window.history.pushState({}, '', '/analytics');
    api.get.mockImplementation((url) => Promise.resolve({ data: responses[url] ?? [], headers: {} }));
    render(<Provider store={makeStore()}><App /></Provider>);
    await waitFor(() => expect(screen.getByText('Peak booking times')).toBeTruthy());
    expect(screen.getAllByText('Analytics').length).toBeGreaterThan(1); // nav link + page title
    expect(screen.getByRole('link', { name: 'Analytics' }).getAttribute('href')).toBe('/analytics');
  });
});
