import { Bar } from 'react-chartjs-2';
import { COLORS, WEEKDAYS, hourLabel } from './chartSetup';

const HOURS = Array.from({ length: 11 }, (_, i) => i + 8); // 08:00 - 18:00
const ORDER = [1, 2, 3, 4, 5, 6, 0]; // Monday first

// Shows WHEN people book: a heatmap (weekday x hour), bookings per hour, and the top slots
export default function PeakTimes({ peak }) {
  if (peak.total === 0) return <p className="muted">No bookings in this period.</p>;

  const max = Math.max(...peak.grid.flat(), 1);
  const topHour = peak.byHour.indexOf(Math.max(...peak.byHour));
  const topDay = peak.byWeekday.indexOf(Math.max(...peak.byWeekday));

  const hourData = {
    labels: HOURS.map(hourLabel),
    datasets: [{ label: 'Bookings', data: HOURS.map((h) => peak.byHour[h]), backgroundColor: COLORS.booked, borderRadius: 3 }],
  };
  const hourOptions = {
    responsive: true, maintainAspectRatio: false,
    scales: { x: { grid: { display: false } }, y: { beginAtZero: true, ticks: { precision: 0 } } },
    plugins: { legend: { display: false } },
  };

  return (
    <div className="peak">
      <p className="insight" data-testid="peak-insight">
        Busiest hour: <strong>{hourLabel(topHour)}</strong> ({peak.byHour[topHour]} bookings).
        Busiest weekday: <strong>{WEEKDAYS[topDay]}</strong> ({peak.byWeekday[topDay]}).
      </p>

      <div className="heatmap" role="table" aria-label="Bookings by weekday and hour">
        <div className="hm-corner" />
        {HOURS.map((h) => <div key={h} className="hm-head">{String(h).padStart(2, '0')}</div>)}
        {ORDER.map((d) => (
          <div className="hm-row" key={d} role="row">
            <div className="hm-day">{WEEKDAYS[d].slice(0, 3)}</div>
            {HOURS.map((h) => {
              const n = peak.grid[d][h];
              return (
                <div
                  key={h} role="cell" className="hm-cell" title={`${WEEKDAYS[d]} ${hourLabel(h)}: ${n} bookings`}
                  style={{ background: n ? `rgba(37, 99, 235, ${0.12 + 0.88 * (n / max)})` : '#f2f4f7', color: n / max > 0.55 ? '#fff' : '#475467' }}
                >
                  {n || ''}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <div className="peak-side">
        <h3>Top 5 busiest slots</h3>
        <ol className="top-slots" data-testid="top-slots">
          {peak.topSlots.map((s) => (
            <li key={`${s.weekday}-${s.hour}`}>
              <span>{WEEKDAYS[s.weekday]} {hourLabel(s.hour)}</span><strong>{s.count}</strong>
            </li>
          ))}
        </ol>
      </div>

      <div className="chart-box small"><Bar data={hourData} options={hourOptions} /></div>
    </div>
  );
}
