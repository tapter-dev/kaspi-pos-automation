export const requireScope = (scope) => (req, res, next) => {
  if (!req.auth?.scopes?.includes(scope)) {
    return res.status(403).json({ error: `API key requires the ${scope} scope.` });
  }
  next();
};
