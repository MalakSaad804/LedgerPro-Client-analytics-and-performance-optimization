import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, Tooltip, Legend,
} from 'chart.js';

// Chart.js only includes the parts we register, which keeps the bundle smaller
ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);
ChartJS.defaults.font.family = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
ChartJS.defaults.color = '#667085';

export const COLORS = { booked: '#2563eb', cancelled: '#d1d5db', completed: '#059669', util: '#7c3aed' };
export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const hourLabel = (h) => `${String(h).padStart(2, '0')}:00`;
