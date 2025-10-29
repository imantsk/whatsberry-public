function apiKeyMiddleware(apiKey) {
    return (req, res, next) => {
        const requestApiKey = req.header('X-API-Key');

        // Require valid API key for all requests
        if (!requestApiKey || requestApiKey !== apiKey) {
            console.log(`[API-KEY-MIDDLEWARE] Unauthorized - Invalid or missing API key`);
            return res.status(401).json({
                error: 'Unauthorized - Invalid or missing API key'
            });
        }

        console.log(`[API-KEY-MIDDLEWARE] Valid API key provided`);
        next();
    };
}

module.exports = apiKeyMiddleware;
