import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';
import api, { errorMessage } from '../api/client';

// Loads the four analytics endpoints in parallel (summary, trends, peak times, staff utilization).
// The API calculates everything with MongoDB aggregation and caches it (see X-Cache header).
export const fetchAnalytics = createAsyncThunk('analytics/fetch', async ({ from, to, interval }, { rejectWithValue }) => {
  try {
    const params = { from, to };
    const [summary, trends, peak, utilization] = await Promise.all([
      api.get('/analytics/summary', { params }),
      api.get('/analytics/trends', { params: { ...params, interval } }),
      api.get('/analytics/peak-times', { params }),
      api.get('/analytics/staff-utilization', { params }),
    ]);
    return {
      summary: summary.data,
      trends: trends.data,
      peak: peak.data,
      utilization: utilization.data,
      cached: [summary, trends, peak, utilization].filter((r) => r.headers['x-cache'] === 'HIT').length,
    };
  } catch (err) {
    return rejectWithValue(errorMessage(err));
  }
});

// used by the real-time connection: when a booking changes, reload the charts with the same settings
export const refreshAnalytics = () => (dispatch, getState) => {
  const params = getState().analytics.params;
  if (params) dispatch(fetchAnalytics(params));
};

const slice = createSlice({
  name: 'analytics',
  initialState: { data: null, params: null, status: 'idle', error: null, loadedAt: null },
  reducers: {},
  extraReducers: (b) => {
    b.addCase(fetchAnalytics.pending, (s, a) => {
      s.params = a.meta.arg;
      if (!s.data) s.status = 'loading'; // later refreshes happen silently, the charts do not flash
    })
      .addCase(fetchAnalytics.fulfilled, (s, a) => {
        s.data = a.payload;
        s.status = 'succeeded';
        s.error = null;
        s.loadedAt = Date.now();
      })
      .addCase(fetchAnalytics.rejected, (s, a) => {
        s.status = s.data ? 'succeeded' : 'failed';
        s.error = a.payload || 'Could not load analytics';
      });
  },
});

export default slice.reducer;
