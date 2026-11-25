import { configureStore } from '@reduxjs/toolkit';
import auth from './authSlice';
import bookings from './bookingsSlice';
import ui from './uiSlice';
import analytics from './analyticsSlice';

export const store = configureStore({ reducer: { auth, bookings, ui, analytics } });
