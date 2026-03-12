/**
 * Async handler wrapper – catches errors in async route handlers.
 */
export function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * 404 Not Found handler.
 */
export function notFoundHandler(req, res, next) {
  const error = new Error(`Route not found: ${req.method} ${req.originalUrl}`);
  error.status = 404;
  next(error);
}

/**
 * Global error handler.
 */
export function errorHandler(err, req, res, next) {
  const status = err.status || err.statusCode || 500;
  const message = err.message || 'Internal Server Error';

  if (status >= 500) {
    console.error('[ERROR]', {
      method: req.method,
      path: req.path,
      status,
      message,
      stack: err.stack,
    });
  } else {
    console.warn('[WARN]', {
      method: req.method,
      path: req.path,
      status,
      message,
    });
  }

  res.status(status).json({
    error: message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
}

/**
 * Request logger middleware.
 */
export function requestLogger(req, res, next) {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    const logLevel = res.statusCode >= 400 ? 'ERROR' : 'INFO';
    console.log(`[${logLevel}] ${req.method} ${req.path} - ${res.statusCode} (${duration}ms)`);
  });

  next();
}
