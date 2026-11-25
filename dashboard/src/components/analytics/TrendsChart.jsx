import { Bar } from 'react-chartjs-2';
import { COLORS } from './chartSetup';

const label = (period, interval) => {
  const d = new Date(`${period}T12:00:00`);
  if (interval === 'month') return d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
  if (interval === 'week') return `Wk ${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
};

// bookings over time: blue = kept, grey = cancelled (stacked)
export default function TrendsChart({ trends }) {
  const { points, interval } = trends;
  const data = {
    labels: points.map((p) => label(p.period, interval)),
    datasets: [
      { label: 'Bookings', data: points.map((p) => p.booked), backgroundColor: COLORS.booked, borderRadius: 3 },
      { label: 'Cancelled', data: points.map((p) => p.cancelled), backgroundColor: COLORS.cancelled, borderRadius: 3 },
    ],
  };
  const options = {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      x: { stacked: true, grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 14 } },
      y: { stacked: true, beginAtZero: true, ticks: { precision: 0 } },
    },
    plugins: { legend: { position: 'bottom' } },
  };
  return <div className="chart-box"><Bar data={data} options={options} /></div>;
}
