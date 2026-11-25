require('dotenv').config();
const http = require('http');
const app = require('./app');
const connectDB = require('./config/db');
const realtime = require('./realtime');
const cache = require('./utils/cache');

if (!process.env.JWT_SECRET || !process.env.MONGO_URI) {
  console.error('Missing JWT_SECRET or MONGO_URI in .env');
  process.exit(1);
}

const PORT = process.env.PORT || 5000;
cache.init(); // uses REDIS_URL when set, otherwise the in-memory fallback
const server = http.createServer(app);
realtime.init(server);

connectDB()
  .then(() => server.listen(PORT, () => console.log(`API running on port ${PORT}`)))
  .catch((err) => {
    console.error('DB connection failed:', err.message);
    process.exit(1);
  });
