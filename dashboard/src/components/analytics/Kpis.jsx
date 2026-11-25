import { WEEKDAYS } from './chartSetup';

const pct = (x) => `${(x * 100).toFixed(1)}%`;

export default function Kpis({ summary }) {
  const day = summary.busiestDay
    ? `${new Date(`${summary.busiestDay.date}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} (${summary.busiestDay.count})`
    : '-';
  const cards = [
    { label: 'Bookings (not cancelled)', value: summary.active, tone: 'blue' },
    { label: 'Completed', value: summary.completed, tone: 'green' },
    { label: 'Cancellation rate', value: pct(summary.cancellationRate), tone: 'grey' },
    { label: 'Average per day', value: summary.avgPerDay.toFixed(1), tone: 'amber' },
    { label: 'Busiest day', value: day, tone: 'blue' },
  ];
  return (
    <>
      <div className="stats" data-testid="kpis">
        {cards.map((c) => (
          <div key={c.label} className={`stat stat-${c.tone}`}>
            <div className="stat-value kpi-value">{c.value}</div>
            <div className="muted">{c.label}</div>
          </div>
        ))}
      </div>
      {summary.topServices.length > 0 && (
        <p className="muted top-services">
          Most booked: {summary.topServices.map((s) => `${s.name} (${s.count})`).join(', ')}
        </p>
      )}
    </>
  );
}

export { WEEKDAYS };
