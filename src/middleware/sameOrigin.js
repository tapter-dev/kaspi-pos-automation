export const requireSameOrigin = (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.headers.origin;
  const fetchSite = req.headers['sec-fetch-site'];
  if (!origin) {
    if (fetchSite && !['same-origin', 'none'].includes(fetchSite)) {
      return res.status(403).json({ error: 'Cross-site requests are not allowed.' });
    }
    return next();
  }
  const expected = process.env.APP_ORIGIN || `${req.protocol}://${req.get('host')}`;
  if (origin !== expected) {
    return res.status(403).json({ error: 'Request origin is not allowed.' });
  }
  next();
};
