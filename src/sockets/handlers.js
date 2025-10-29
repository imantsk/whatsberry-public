/**
 * Setup Socket.IO event handlers for WebSocket communication
 * @param {SocketIO.Server} io - Socket.IO server instance
 * @param {Object} sessionManager - Session manager instance
 */
function setupSocketHandlers(io, sessionManager) {
    io.on('connection', (socket) => {
        console.log(`[WebSocket] Client connected: ${socket.id} at ${new Date().toISOString()}`);
        console.log(`[WebSocket] Total connected clients: ${io.engine.clientsCount}`);

        // Enhanced join session handling
        socket.on('join_session', (sessionId) => {
            console.log(`Socket ${socket.id} attempting to join session ${sessionId}`);

            socket.join(`session_${sessionId}`);

            // Emit join confirmation
            socket.emit('session_joined', { sessionId, socketId: socket.id });

            // Send current session status if available
            const session = sessionManager.sessions.get(sessionId);
            if (session) {
                console.log(`Session ${sessionId} exists, status: ready=${session.isReady}, hasQR=${!!session.qrCode}`);

                if (session.qrCode) {
                    console.log(`Sending existing QR code to socket ${socket.id}`);
                    socket.emit('qr', session.qrCode);
                }

                if (session.isReady) {
                    console.log(`[WebSocket] Session ${sessionId} is ready, notifying socket ${socket.id}`);
                    socket.emit('ready', {
                        phoneNumber: session.phoneNumber,
                        sessionId: sessionId
                    });
                }

                // Update last activity
                session.lastActivity = Date.now();
            } else {
                console.log(`Session ${sessionId} not found for socket ${socket.id}`);
            }
        });

        // Leave session room
        socket.on('leave_session', (sessionId) => {
            socket.leave(`session_${sessionId}`);
        });

        // Request QR code
        socket.on('request_qr', (sessionId) => {
            console.log(`QR code requested for session ${sessionId} by socket ${socket.id}`);
            const session = sessionManager.sessions.get(sessionId);

            if (session && session.qrCode) {
                console.log(`Sending QR code to socket ${socket.id} for session ${sessionId}`);
                socket.emit('qr', session.qrCode);
            } else {
                console.log(`No QR code available for session ${sessionId}. Session exists: ${!!session}, Has QR: ${session ? !!session.qrCode : 'N/A'}`);
            }
        });

        // Debug ping-pong
        socket.on('ping', () => {
            console.log(`🏓 Ping received from ${socket.id}`);
            socket.emit('pong', { timestamp: Date.now() });
        });

        // Request session status
        socket.on('request_session_status', (sessionId) => {
            const session = sessionManager.sessions.get(sessionId);

            if (session) {
                socket.emit('session_status', {
                    sessionId: sessionId,
                    isReady: session.isReady,
                    hasQR: !!session.qrCode,
                    lastActivity: session.lastActivity,
                    phoneNumber: session.phoneNumber
                });
            } else {
                socket.emit('session_status', {
                    sessionId: sessionId,
                    error: 'Session not found'
                });
            }
        });

        socket.on('disconnect', (reason) => {
            console.log(`[WebSocket] Client disconnected: ${socket.id}, reason: ${reason} at ${new Date().toISOString()}`);
            console.log(`[WebSocket] Remaining connected clients: ${io.engine.clientsCount}`);
        });

        socket.on('error', (error) => {
            console.error(`[WebSocket] Socket error for ${socket.id}:`, error);
        });
    });
}

module.exports = setupSocketHandlers;
