import { createSlice, nanoid } from '@reduxjs/toolkit';

const slice = createSlice({
  name: 'ui',
  initialState: {
    toasts: [],
    selectedBookingId: null, // which booking's window is open (rendered once, in App.jsx)
    connection: 'connecting', // real-time connection: connecting | live | offline
  },
  reducers: {
    toast: {
      reducer(state, a) { state.toasts.push(a.payload); },
      prepare(text, type = 'info') { return { payload: { id: nanoid(), text, type } }; },
    },
    dismissToast(state, a) { state.toasts = state.toasts.filter((t) => t.id !== a.payload); },
    openBooking(state, a) { state.selectedBookingId = a.payload; },
    closeBooking(state) { state.selectedBookingId = null; },
    setConnection(state, a) { state.connection = a.payload; },
  },
});

export const { toast, dismissToast, openBooking, closeBooking, setConnection } = slice.actions;
export default slice.reducer;
