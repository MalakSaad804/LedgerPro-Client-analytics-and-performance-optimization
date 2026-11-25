import { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { fetchAnalytics } from '../store/analyticsSlice';
import { ErrorBox, Spinner } from '../components/ui';
import Kpis from '../components/analytics/Kpis';
import TrendsChart from '../components/analytics/TrendsChart';
import PeakTimes from '../components/analytics/PeakTimes';
import StaffUtilization from '../components/analytics/StaffUtilization';
import '../components/analytics/chartSetup';

const day = (offset) => new Date(Date.now() + offset * 86400000).toLocaleDateString('en-CA'); // YYYY-MM-DD

const PRESETS = {
  mixed: { label: 'Past 30 + next 14 days', from: () => day(-30), to: () => day(14) },
  past30: { label: 'Last 30 days', from: () => day(-29), to: () => day(0) },
  past90: { label: 'Last 90 days', from: () => day(-89), to: () => day(0) },
  next14: { label: 'Next 14 days', from: () => day(0), to: () => day(14) },
};

export default function AnalyticsPage() {
  const dispatch = useDispatch();
  const { data, status, error, loadedAt } = useSelector((s) => s.analytics);
  const user = useSelector((s) => s.auth.user);
  const [preset, setPreset] = useState('mixed');
  const [interval, setInterval] = useState('day');

  const load = () => dispatch(fetchAnalytics({ from: PRESETS[preset].from(), to: PRESETS[preset].to(), interval }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [preset, interval]);

  return (
    <div>
      <div className="page-head">
        <h1>Analytics</h1>
        <div className="filters">
          <select aria-label="Period" value={preset} onChange={(e) => setPreset(e.target.value)}>
            {Object.entries(PRESETS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          <select aria-label="Group by" value={interval} onChange={(e) => setInterval(e.target.value)}>
            <option value="day">By day</option>
            <option value="week">By week</option>
            <option value="month">By month</option>
          </select>
        </div>
      </div>
      <p className="muted">
        {user?.role === 'admin' ? 'All staff.' : 'Your own bookings only.'}
        {data && ` ${data.cached} of 4 results came from the cache.`}
        {loadedAt && ` Updated ${new Date(loadedAt).toLocaleTimeString('en-GB')}.`}
      </p>

      {status === 'loading' && <Spinner label="Crunching the numbers..." />}
      {status === 'failed' && <ErrorBox message={error} onRetry={load} />}
      {status === 'succeeded' && error && <ErrorBox message={error} onRetry={load} />}

      {data && (
        <>
          <Kpis summary={data.summary} />
          <section className="card section">
            <h2>Booking trends</h2>
            <TrendsChart trends={data.trends} />
          </section>
          <section className="card section">
            <h2>Peak booking times</h2>
            <PeakTimes peak={data.peak} />
          </section>
          <section className="card section">
            <h2>Staff utilization</h2>
            <StaffUtilization utilization={data.utilization} />
          </section>
        </>
      )}
    </div>
  );
}
