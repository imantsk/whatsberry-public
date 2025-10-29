/**
 * Setup authentication routes
 * @param {Express} app - Express app instance
 * @param {Object} sessionManager - Session manager with sessions Map and middleware functions
 * @param {Object} audioConverter - Audio converter instance (not used in auth routes but kept for consistency)
 */
function setupAuthRoutes(app, sessionManager) {
    // Create or get session (API key protected)
    app.post('/create-session', sessionManager.apiKeyMiddleware, async (req, res) => {
        console.log('[CREATE-SESSION] Request received at', new Date().toISOString());
        console.log('[CREATE-SESSION] Request body:', JSON.stringify(req.body).substring(0, 200));

        try {
            const { deviceInfo } = req.body;

            if (!deviceInfo) {
                console.log('[CREATE-SESSION] No device info provided');
                return res.status(400).json({ error: 'Device info required' });
            }

            const userId = sessionManager.generateUserId(deviceInfo);
            console.log('[CREATE-SESSION] Generated userId:', userId);

            const sessionId = sessionManager.getOrCreateSession(userId, deviceInfo);
            console.log('[CREATE-SESSION] Session ID:', sessionId);

            const response = {
                sessionId: sessionId,
                userId: userId,
                message: 'Session created successfully'
            };

            console.log('[CREATE-SESSION] Sending response:', JSON.stringify(response));
            res.json(response);
        } catch (error) {
            console.error('[CREATE-SESSION] Error creating session:', error);
            res.status(500).json({ error: error.message });
        }
    });


    // Get QR code for session (API key protected)
    app.get('/session/:sessionId/qr', sessionManager.apiKeyMiddleware, (req, res) => {
        const { sessionId } = req.params;
        const session = sessionManager.sessions.get(sessionId);

        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }

        if (session.qrCode) {
            res.json({ qr: session.qrCode });
        } else {
            res.status(404).json({ error: 'QR code not available' });
        }
    });

    // Start WhatsApp session - handler function
    const startSessionHandler = async (req, res) => {
        try {
            // Support both URL param and body param for backwards compatibility
            const sessionId = req.params.sessionId || req.body.sessionId;

            if (!sessionId) {
                return res.status(400).json({ error: 'Session ID required' });
            }

            console.log(`[START-SESSION] - Session: ${sessionId} - Timestamp: ${Date.now()}`);

            const session = sessionManager.sessions.get(sessionId);

            console.log(`[START-SESSION] Starting session: ${sessionId}`);

            if (!session) {
                console.log(`[START-SESSION] Session not found: ${sessionId}`);
                return res.status(404).json({ error: 'Session not found' });
            }

            // Check if this session belongs to the current user
            const { userId } = session;
            const currentUserSessionId = sessionManager.userSessions.get(userId);

            if (currentUserSessionId !== sessionId) {
                console.log(`[START-SESSION] Ignoring start-session for old session ${sessionId}. User ${userId} has newer session ${currentUserSessionId}`);
                return res.status(410).json({
                    error: 'This session has been replaced by a newer session',
                    currentSessionId: currentUserSessionId
                });
            }

            if (session.client) {
                console.log(`Session ${sessionId} already has a client`);
                return res.json({ message: 'Session already started' });
            }

            console.log(`[START-SESSION] Initializing WhatsApp client for session: ${sessionId}`);

            // Small delay to ensure socket room connections are established
            await new Promise(resolve => setTimeout(resolve, 500));

            try {
                await sessionManager.initializeClient(sessionId);
                console.log(`[START-SESSION] Session ${sessionId} initialization started successfully`);
                res.json({ message: 'Session initialization started' });
            } catch (primaryError) {
                console.log(`[START-SESSION] Primary initialization failed for ${sessionId}, trying fallback method...`);

                try {
                    await sessionManager.initializeClientFallback(sessionId);
                    console.log(`[START-SESSION] Session ${sessionId} initialized successfully using fallback method`);
                    res.json({ message: 'Session initialization started (fallback method)' });
                } catch (fallbackError) {
                    console.error(`[START-SESSION] Both initialization methods failed for ${sessionId}:`, fallbackError);
                    res.status(500).json({
                        error: 'Failed to start session',
                        details: fallbackError.message
                    });
                }
            }
        } catch (error) {
            console.error('Error starting session:', error);
            res.status(500).json({ error: error.message });
        }
    };

    // Start WhatsApp session - supports both /init and /start-session/:sessionId
    app.post('/init', sessionManager.apiKeyMiddleware, startSessionHandler);
    app.post('/start-session/:sessionId', sessionManager.apiKeyMiddleware, startSessionHandler);

    // Logout/destroy session
    app.post('/session/:sessionId/logout', sessionManager.apiKeyMiddleware, async (req, res) => {
        try {
            const { sessionId } = req.params;

            // Destroy WhatsApp session
            await sessionManager.destroySession(sessionId);
            res.json({ message: 'Session destroyed successfully' });
        } catch (error) {
            console.error('Error logging out:', error);
            res.status(500).json({ error: error.message });
        }
    });
}

module.exports = { setupAuthRoutes };
