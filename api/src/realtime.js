const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');

let io = null;

// Live updates: staff dashboards connect here with their JWT.
// Each staff member joins a private room, so events only reach the right person.
function init(httpServer) {
  const origins = process.env.CLIENT_ORIGIN ? process.env.CLIENT_ORIGIN.split(',') : '*';
  io = new Server(httpServer, { cors: { origin: origins } });

  io.use((socket, next) => {
    try {
      const payload = jwt.verify(socket.handshake.auth?.token || '', process.env.JWT_SECRET);
      if (!['staff', 'admin'].includes(payload.role)) return next(new Error('FORBIDDEN'));
      socket.user = payload;
      next();
    } catch {
      next(new Error('UNAUTHORIZED'));
    }
  });

  io.on('connection', (socket) => {
    socket.join(socket.user.role === 'admin' ? 'admins' : `staff:${socket.user.id}`);
  });
  return io;
}

// Tell the assigned staff member (and admins) that a booking changed.
// Only the id and action are sent: the dashboard re-fetches through the protected API.
function emitBookingChange(booking, action) {
  if (!io) return;
  const payload = { id: String(booking._id), action };
  if (booking.staff) io.to(`staff:${booking.staff}`).emit('booking:changed', payload);
  io.to('admins').emit('booking:changed', payload);
}

module.exports = { init, emitBookingChange };
