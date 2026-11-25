const SLOW_MS = Number(process.env.SLOW_REQUEST_MS || 300);

// Adds a Server-Timing header (visible in the browser's Network tab)
// and logs requests slower than SLOW_REQUEST_MS.
module.exports = (req, res, next) => {
  const start = process.hrtime.bigint();
  const writeHead = res.writeHead;
  res.writeHead = function patched(...args) {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    if (!res.headersSent) res.setHeader('Server-Timing', `app;dur=${ms.toFixed(1)}`);
    return writeHead.apply(this, args);
  };
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    if (ms >= SLOW_MS) console.warn(`SLOW REQUEST ${req.method} ${req.originalUrl} ${ms.toFixed(0)}ms`);
  });
  next();
};
