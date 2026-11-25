import { Bar } from 'react-chartjs-2';
import { COLORS } from './chartSetup';

const hours = (mins) => `${(mins / 60).toFixed(1)} h`;

// How busy is each accountant? utilization = booked time / working time in the period
export default function StaffUtilization({ utilization }) {
  const { staff, scope } = utilization;
  if (staff.length === 0) return <p className="muted">No working hours are set for staff in this period.</p>;

  const data = {
    labels: staff.map((s) => s.name),
    datasets: [{ label: 'Utilization %', data: staff.map((s) => Math.round(s.utilization * 1000) / 10), backgroundColor: COLORS.util, borderRadius: 4 }],
  };
  const options = {
    indexAxis: 'y', responsive: true, maintainAspectRatio: false,
    scales: { x: { min: 0, max: 100, ticks: { callback: (v) => `${v}%` } }, y: { grid: { display: false } } },
    plugins: { legend: { display: false } },
  };

  return (
    <div>
      {scope === 'own' && <p className="muted">You only see your own numbers.</p>}
      <div className="chart-box small" style={{ height: Math.max(120, staff.length * 46 + 40) }}>
        <Bar data={data} options={options} />
      </div>
      <div className="table-wrap card flat">
        <table data-testid="util-table">
          <thead>
            <tr><th>Staff</th><th>Bookings</th><th>Booked</th><th>Available</th><th>Cancelled</th><th>Utilization</th></tr>
          </thead>
          <tbody>
            {staff.map((s) => (
              <tr key={s.staffId}>
                <td>{s.name}</td>
                <td>{s.bookings}</td>
                <td>{hours(s.bookedMinutes)}</td>
                <td>{hours(s.availableMinutes)}</td>
                <td>{s.cancelled}</td>
                <td>
                  <div className="meter"><div className="meter-fill" style={{ width: `${s.utilization * 100}%` }} /></div>
                  <strong>{(s.utilization * 100).toFixed(1)}%</strong>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
