const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');
const {
    SESSION_TIMEOUT,
    UNFINISHED_SESSION_TIMEOUT
} = require('../config/constants');

// SessionManager - Manages WhatsApp Web sessions
class SessionManager {
    constructor(io = null) {
        // Store multiple client sessions
        // sessionId -> { client, isReady, qrCode, userId, lastActivity, ... }
        this.sessions = new Map();

        // Map user IDs to their active session IDs
        // userId -> sessionId
        this.userSessions = new Map();

        // Session timeout settings
        this.sessionTimeout = SESSION_TIMEOUT;
        this.unfinishedSessionTimeout = UNFINISHED_SESSION_TIMEOUT;

        // CPU usage tracking for accurate calculation
        this.previousCpuUsage = null;
        this.lastCpuCheck = Date.now();

        // Socket.io instance for emitting events
        this.io = io;
    }

    /**
     * Set the Socket.IO instance
     * @param {Object} io - Socket.IO server instance
     */
    setIO(io) {
        this.io = io;
    }

    /**
     * Generate a unique session ID using UUID v4
     * @returns {string} A unique session identifier
     */
    generateSessionId() {
        return uuidv4();
    }

    /**
     * Generate a user ID from device information
     * Creates a consistent hash from device info for user identification
     * @param {Object} deviceInfo - Device information object
     * @returns {string} A 16-character hash representing the user ID
     */
    generateUserId(deviceInfo) {
        const data = JSON.stringify(deviceInfo);
        return crypto.createHash('sha256').update(data).digest('hex').substring(0, 16);
    }

    /// Clean up inactive sessions
    cleanupInactiveSessions() {
        const now = Date.now();
        for (const [sessionId, session] of this.sessions.entries()) {
            if (now - session.lastActivity > this.sessionTimeout) {
                console.log(`Cleaning up inactive session: ${sessionId}`);
                this.destroySession(sessionId);
            }
        }
    }

    // Clean up unfinished sessions
    cleanupUnfinishedSessions() {
        const now = Date.now();
        let cleanedCount = 0;

        for (const [sessionId, session] of this.sessions.entries()) {
            // Only cleanup sessions that are not ready and not authenticated
            if (!session.isReady && !session.isAuthenticated && (now - session.lastActivity > this.unfinishedSessionTimeout)) {
                console.log(`🧹 Cleaning up unfinished session: ${sessionId} (inactive for ${Math.round((now - session.lastActivity) / 1000 / 60)} minutes)`);
                this.destroySession(sessionId);
                cleanedCount++;
            }
        }

        if (cleanedCount > 0) {
            console.log(`🧹 Cleaned up ${cleanedCount} unfinished session(s)`);
        }
    }

    // Check session health and reconnect if needed
    async checkSessionHealth() {
        console.log(`Checking health of ${this.sessions.size} sessions...`);

        for (const [sessionId, session] of this.sessions.entries()) {
            try {
                // Skip old/replaced sessions - only check current user sessions
                const { userId } = session;
                const currentUserSessionId = this.userSessions.get(userId);
                if (currentUserSessionId !== sessionId) {
                    console.log(`Skipping health check for old session ${sessionId} (user has newer session)`);
                    continue;
                }

                // Skip if session was recently active (less than 5 minutes ago)
                const timeSinceActivity = Date.now() - session.lastActivity;
                if (timeSinceActivity < 5 * 60 * 1000) {
                    continue;
                }

                // Check if client exists and is ready
                if (!session.client || !session.isReady) {
                    console.log(`Session ${sessionId} not ready, attempting reconnection...`);
                    await this.reconnectSession(sessionId);
                    continue;
                }

                // Test if client is still responsive
                try {
                    const testPromise = Promise.race([
                        session.client.getState(),
                        new Promise((_, reject) =>
                            setTimeout(() => reject(new Error('Health check timeout')), 10000)
                        )
                    ]);

                    const state = await testPromise;
                    console.log(`Session ${sessionId} health check passed, state: ${state}`);

                } catch (healthError) {
                    console.log(`Session ${sessionId} failed health check: ${healthError.message}`);
                    await this.reconnectSession(sessionId);
                }

            } catch (error) {
                console.error(`Error checking session ${sessionId} health:`, error.message);
                await this.reconnectSession(sessionId);
            }
        }
    }

    /**
     * Check if a session is healthy and can perform operations
     * @param {string} sessionId - The session ID to check
     * @returns {Promise<boolean>} True if session is healthy, false otherwise
     */
    async isSessionHealthy(sessionId) {
        const session = this.sessions.get(sessionId);

        if (!session || !session.client || !session.isReady || session.reconnecting) {
            return false;
        }

        try {
            // Quick health check with timeout
            const statePromise = session.client.getState();
            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Health check timeout')), 5000)
            );

            await Promise.race([statePromise, timeoutPromise]);
            return true;
        } catch (error) {
            console.log(`Session ${sessionId} health check failed: ${error.message}`);
            return false;
        }
    }

    /**
     * Reconnect a disconnected session
     * Attempts to reinitialize a session that has become unhealthy
     * @param {string} sessionId - The session ID to reconnect
     * @param {Function} initializeClient - Callback function to reinitialize the client
     * @param {Function} initializeClientFallback - Fallback callback if primary initialization fails
     */
    async reconnectSession(sessionId, initializeClient = null, initializeClientFallback = null) {
        const session = this.sessions.get(sessionId);
        if (!session) {
            console.log(`Session ${sessionId} not found for reconnection`);
            return;
        }

        // Prevent duplicate reconnections
        if (session.reconnecting) {
            console.log(`Session ${sessionId} is already reconnecting, skipping...`);
            return;
        }

        console.log(`Attempting to reconnect session: ${sessionId}`);
        session.reconnecting = true;

        try {
            // Clean up existing client if it exists
            if (session.client) {
                try {
                    await session.client.destroy();
                } catch (destroyError) {
                    console.log(`Error destroying old client for ${sessionId}: ${destroyError.message}`);
                }
            }

            // Reset session state
            session.client = null;
            session.isReady = false;
            session.isAuthenticated = false;
            session.qrCode = null;

            // Notify clients about reconnection
            if (this.io) {
                this.io.to(`session_${sessionId}`).emit('reconnecting', {
                    sessionId,
                    message: 'Session reconnecting...'
                });
            }

            // Attempt to reinitialize the client
            if (initializeClient) {
                await initializeClient(sessionId);
                console.log(`Session ${sessionId} reconnected successfully`);
                session.reconnecting = false;
            } else {
                console.log(`No initializeClient function provided for session ${sessionId}`);
                session.reconnecting = false;
            }

        } catch (reconnectError) {
            console.error(`Failed to reconnect session ${sessionId}:`, reconnectError.message);

            // If reconnection fails, try fallback method
            if (initializeClientFallback) {
                try {
                    await initializeClientFallback(sessionId);
                    console.log(`Session ${sessionId} reconnected using fallback method`);
                    session.reconnecting = false;
                } catch (fallbackError) {
                    console.error(`Fallback reconnection also failed for ${sessionId}:`, fallbackError.message);

                    // Emit error to clients
                    if (this.io) {
                        this.io.to(`session_${sessionId}`).emit('reconnection_failed', {
                            sessionId,
                            error: 'Session reconnection failed'
                        });
                    }

                    // Clear reconnecting flag even on failure so user can retry
                    session.reconnecting = false;
                }
            } else {
                // No fallback available
                if (this.io) {
                    this.io.to(`session_${sessionId}`).emit('reconnection_failed', {
                        sessionId,
                        error: 'Session reconnection failed'
                    });
                }
                session.reconnecting = false;
            }
        }
    }

    /**
     * Destroy a session
     * Cleans up session resources, removes from maps, and deletes session data
     * @param {string} sessionId - The session ID to destroy
     */
    async destroySession(sessionId) {
        const session = this.sessions.get(sessionId);
        if (session) {
            try {
                if (session.client) {
                    await session.client.destroy();
                }

                this.sessions.delete(sessionId);
                this.userSessions.delete(session.userId);

                // Delete session data folder from disk
                const sessionPath = path.join(__dirname, '../data', sessionId);
                try {
                    await fs.rm(sessionPath, { recursive: true, force: true });
                    console.log(`Deleted session data folder: ${sessionPath}`);
                } catch (fsError) {
                    console.log(`Could not delete session folder ${sessionPath}: ${fsError.message}`);
                }

                // Emit session destroyed event
                if (this.io) {
                    this.io.to(`session_${sessionId}`).emit('session_destroyed');
                }
            } catch (error) {
                console.error(`Error destroying session ${sessionId}:`, error);
            }
        }
    }

    /**
     * Get or create session for user
     * If user has existing session, cleans it up and creates a new one
     * @param {string} userId - The user ID
     * @param {Object} deviceInfo - Device information for the session
     * @returns {string} The session ID (new or existing)
     */
    getOrCreateSession(userId, deviceInfo) {
        // Check if user already has an active session
        const existingSessionId = this.userSessions.get(userId);
        if (existingSessionId && this.sessions.has(existingSessionId)) {
            const session = this.sessions.get(existingSessionId);

            // Clean up old session if it exists and create a new one
            console.log(`User ${userId} has existing session ${existingSessionId}, cleaning it up to create fresh session`);
            this.destroySession(existingSessionId).catch(err => {
                console.error(`Failed to cleanup old session: ${err.message}`);
            });

            // Remove the old mapping
            this.userSessions.delete(userId);
        }

        // Create new session
        const sessionId = this.generateSessionId();
        const session = {
            client: null,
            isReady: false,
            isAuthenticated: false,
            qrCode: null,
            userId: userId,
            deviceInfo: deviceInfo,
            lastActivity: Date.now(),
            phoneNumber: null,
            reconnecting: false
        };

        this.sessions.set(sessionId, session);
        this.userSessions.set(userId, sessionId);

        console.log(`Created new session ${sessionId} for user ${userId}`);
        return sessionId;
    }

    /**
     * Format a WhatsApp message object for API responses
     * Extracts and structures message data including media, contacts, and quoted messages
     * @param {Object} message - The WhatsApp message object
     * @param {string} sessionId - The session ID (optional, for media download URLs)
     * @param {boolean} includeMediaData - Whether to download and include media data
     * @param {boolean} skipContact - Whether to skip fetching contact information
     * @returns {Promise<Object|null>} Formatted message object or null on error
     */
    async formatMessage(message, sessionId = null, includeMediaData = false, skipContact = false) {
        try {
            let contact = null;

            // Only fetch contact if needed
            if (!skipContact) {
                try {
                    contact = await Promise.race([
                        message.getContact(),
                        new Promise((_, reject) =>
                            setTimeout(() => reject(new Error('Contact timeout')), 500)
                        )
                    ]);
                } catch (error) {
                    // Contact fetch failed, use fallback
                }
            }

            let mediaData = null;
            let mediaDownloadUrl = null;

            if (message.hasMedia) {
                // Create download URL for the media
                if (sessionId) {
                    mediaDownloadUrl = `/session/${sessionId}/message/${message.id._serialized}/media`;
                }

                // Only download media data if explicitly requested
                if (includeMediaData) {
                    try {
                        const media = await message.downloadMedia();
                        mediaData = {
                            mimetype: media.mimetype,
                            data: media.data,
                            filename: media.filename || `media_${Date.now()}`
                        };
                    } catch (error) {
                        console.error('Error downloading media:', error);
                    }
                }
            }

            // Get quoted message if present
            let quotedMsg = null;
            if (message.hasQuotedMsg) {
                try {
                    const quoted = await Promise.race([
                        message.getQuotedMessage(),
                        new Promise((_, reject) =>
                            setTimeout(() => reject(new Error('Quoted message timeout')), 500)
                        )
                    ]);

                    if (quoted) {
                        // Get contact info for the quoted message sender
                        let quotedContact = null;
                        try {
                            quotedContact = await Promise.race([
                                quoted.getContact(),
                                new Promise((_, reject) =>
                                    setTimeout(() => reject(new Error('Contact timeout')), 500)
                                )
                            ]);
                        } catch (error) {
                            // Failed to fetch contact, continue without it
                        }

                        // Format quoted message (simplified to avoid deep recursion)
                        quotedMsg = {
                            id: quoted.id._serialized,
                            body: quoted.body,
                            from: quoted.from,
                            to: quoted.to,
                            fromMe: quoted.fromMe,
                            timestamp: quoted.timestamp,
                            type: quoted.type,
                            hasMedia: quoted.hasMedia,
                            mediaKey: quoted.mediaKey || null,
                            who: quotedContact ? (quotedContact.name || quotedContact.pushname || quotedContact.number) : null
                        };
                    }
                } catch (error) {
                    // Failed to fetch quoted message, continue without it
                }
            }

            return {
                // Basic message info
                id: message.id._serialized,
                body: message.body,
                from: message.from,
                to: message.to,
                fromMe: message.fromMe,
                timestamp: message.timestamp,
                type: message.type,

                // Author (for group messages)
                author: message.author || null,

                // Message status and properties
                ack: message.ack || null,
                broadcast: message.broadcast || false,
                deviceType: message.deviceType || null,
                duration: message.duration || null,
                forwardingScore: message.forwardingScore || 0,

                // Message features
                hasMedia: message.hasMedia,
                hasQuotedMsg: message.hasQuotedMsg || false,
                quotedMsg: quotedMsg,
                hasReaction: message.hasReaction || false,

                // Message states
                isEphemeral: message.isEphemeral || false,
                isForwarded: message.isForwarded || false,
                isGif: message.isGif || false,
                isStarred: message.isStarred || false,
                isStatus: message.isStatus || false,

                // Media and download info
                mediaData: mediaData,
                mediaDownloadUrl: mediaDownloadUrl,
                mediaKey: message.mediaKey || null,

                // Group and mentions
                groupMentions: message.groupMentions || [],
                mentionedIds: message.mentionedIds || [],

                // Links
                links: message.links || [],

                // Location data
                location: message.location || null,

                // Order info
                orderId: message.orderId || null,
                token: message.token || null,

                // vCards
                vCards: message.vCards || [],

                // Invite data
                inviteV4: message.inviteV4 || null,

                // Contact info
                contact: contact ? {
                    name: contact.name || contact.pushname,
                    number: contact.number,
                    isMyContact: contact.isMyContact
                } : null
            };
        } catch (error) {
            console.error('Error formatting message:', error);
            return null;
        }
    }
}

module.exports = SessionManager;
