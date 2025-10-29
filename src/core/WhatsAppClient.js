const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const { puppeteer, getPuppeteerConfig, getFallbackPuppeteerConfig } = require('../config/puppeteer');

/**
 * Initialize WhatsApp client with full configuration
 *
 * @param {string} sessionId - The session identifier
 * @param {Object} session - The session object
 * @param {Object} sessionManager - The session manager instance (for formatMessage)
 * @param {Object} io - Socket.io server instance
 * @param {string} sessionDir - Directory path for session data
 * @returns {Promise<Client>} The initialized WhatsApp client
 * @throws {Error} If initialization fails or times out
 */
async function initializeClient(sessionId, session, sessionManager, io, sessionDir) {
    const startTime = Date.now();

    function log(message) {
        const elapsed = Date.now() - startTime;
        console.log(`[${sessionId}] [${elapsed}ms] ${message}`);
    }

    log('Starting WhatsApp client initialization');

    // Session directory creation
    await fs.mkdir(sessionDir, { recursive: true });
    log(`Session directory: ${sessionDir}`);

    // Check if session has existing auth data
    try {
        const authFiles = await fs.readdir(sessionDir);
        if (authFiles.length > 0) {
            log(`Found existing auth data in session directory (${authFiles.length} files) - will attempt to restore session`);
        } else {
            log(`Clean session directory - new QR will be generated`);
        }
    } catch (error) {
        log(`Session directory is empty or new`);
    }

    // Get Puppeteer configuration with stealth plugin
    const puppeteerConfig = getPuppeteerConfig();

    log('Using Puppeteer with stealth plugin (anti-detection)');

    // Create client with stealth configuration
    const client = new Client({
        authStrategy: new LocalAuth({
            clientId: sessionId,
            dataPath: sessionDir
        }),
        puppeteer: puppeteerConfig
    });

    log('Client created with minimal config');

    // QR tracking
    let qrReceived = false;

    // Simplified QR code event handling
    client.on('qr', async (qr) => {
        qrReceived = true;

        try {
            // Simple QR code generation
            const qrCodeDataURL = await qrcode.toDataURL(qr);
            session.qrCode = qrCodeDataURL;

            log(`QR generated, emitting to sockets...`);

            // Get room info for debugging
            const roomName = `session_${sessionId}`;
            const room = io.sockets.adapter.rooms.get(roomName);
            const socketCount = room ? room.size : 0;
            log(`Emitting QR to room "${roomName}" with ${socketCount} connected sockets`);

            // Direct emit to session room
            io.to(roomName).emit('qr', qrCodeDataURL);

            log(`QR code emitted successfully`);

        } catch (error) {
            log(`QR generation failed: ${error.message}`);
            io.to(`session_${sessionId}`).emit('auth_failure', `QR generation failed: ${error.message}`);
        }
    });

    // Simplified event handlers
    client.on('ready', async () => {
        // Prevent duplicate ready events
        if (session.isReady) {
            log(`Ready event fired but session already ready`);
            return;
        }
        log(`Client is ready`);
        session.isReady = true;
        session.qrCode = null;

        try {
            const info = client.info;
            session.phoneNumber = info.wid.user;

            io.to(`session_${sessionId}`).emit('ready', {
                phoneNumber: session.phoneNumber,
                sessionId: sessionId
            });
        } catch (error) {
            io.to(`session_${sessionId}`).emit('ready', { sessionId: sessionId });
        }
    });

    client.on('authenticated', () => {
        // Prevent duplicate authentication logs/events
        if (session.isAuthenticated) {
            log(`Authenticated event fired but session already authenticated)`);
            return;
        }
        log(`Authenticated`);
        session.isAuthenticated = true;
        session.lastActivity = Date.now(); // Update activity to prevent cleanup
        io.to(`session_${sessionId}`).emit('authenticated');
    });

    // Monitor loading screen progress to diagnose sync issues
    client.on('loading_screen', (percent, message) => {
        log(`Loading WhatsApp: ${percent}% - ${message}`);
        session.lastActivity = Date.now(); // Keep session alive during loading
        io.to(`session_${sessionId}`).emit('loading_screen', { percent, message });
    });

    client.on('auth_failure', (msg) => {
        log(`Auth failure: ${msg}`);
        session.isAuthenticated = false;
        io.to(`session_${sessionId}`).emit('auth_failure', msg);
    });

    client.on('disconnected', (reason) => {
        log(`Disconnected: ${reason}`);
        const timeSinceReady = session.isReady ? Date.now() - startTime : 'N/A';
        console.log(`Session ${sessionId} disconnected after ${timeSinceReady}ms. Reason: ${reason}`);
        console.log(`Session ${sessionId} state - isAuthenticated: ${session.isAuthenticated}, isReady: ${session.isReady}`);

        session.isReady = false;
        // Keep isAuthenticated = true, user is still authenticated even if disconnected
        io.to(`session_${sessionId}`).emit('disconnected', reason);

        // If logout happened shortly after ready, this might be WhatsApp anti-bot
        if (reason === 'LOGOUT' && timeSinceReady !== 'N/A' && timeSinceReady < 120000) {
            console.log(`[WA Anti-Bot] Session ${sessionId} logged out ${timeSinceReady}ms after ready - possible anti-bot detection`);
        }
    });

    // Simple error handling
    client.on('error', (error) => {
        log(`Client error: ${error.message}`);
        io.to(`session_${sessionId}`).emit('auth_failure', `Error: ${error.message}`);
    });

    // Real-time message listener
    client.on('message', async (message) => {
        try {
            // Format the message with all attributes
            const formattedMessage = await sessionManager.formatMessage(message, sessionId, false, false);

            if (formattedMessage) {
                // Emit to all clients listening to this session
                io.to(`session_${sessionId}`).emit('message', formattedMessage);
            }
        } catch (error) {
            log(`Error handling incoming message: ${error.message}`);
        }
    });

    // Real-time message acknowledgment listener (when messages are sent/delivered/read)
    client.on('message_ack', async (message, ack) => {
        try {
            io.to(`session_${sessionId}`).emit('message_ack', {
                messageId: message.id._serialized,
                ack: ack,
                timestamp: Date.now()
            });
        } catch (error) {
            log(`Error handling message ACK: ${error.message}`);
        }
    });

    // Real-time message revoke listener (when messages are deleted)
    client.on('message_revoke_everyone', async (message, revokedMessage) => {
        try {
            io.to(`session_${sessionId}`).emit('message_revoke', {
                messageId: message.id._serialized,
                revokedMessage: revokedMessage ? {
                    id: revokedMessage.id._serialized,
                    body: revokedMessage.body
                } : null,
                timestamp: Date.now()
            });
        } catch (error) {
            log(`Error handling message revoke: ${error.message}`);
        }
    });

    // Real-time reaction listener (when reactions are added/removed)
    client.on('message_reaction', async (reaction) => {
        try {
            io.to(`session_${sessionId}`).emit('message_reaction', {
                messageId: reaction.msgId._serialized,
                reaction: reaction.reaction,
                timestamp: reaction.timestamp,
                senderId: reaction.senderId
            });
        } catch (error) {
            log(`Error handling message reaction: ${error.message}`);
        }
    });

    session.client = client;

    log(`Initializing client with 45s timeout...`);

    try {
        // Initialize with longer timeout but no complex monitoring
        const initPromise = client.initialize();
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Initialization timeout after 45 seconds')), 45000);
        });

        await Promise.race([initPromise, timeoutPromise]);

        log(`Initialization completed successfully`);

    } catch (error) {
        log(`Initialization failed: ${error.message}`);

        // Simple cleanup
        if (session.client) {
            try {
                await session.client.destroy();
            } catch (e) {
                // Ignore cleanup errors
            }
        }

        session.client = null;
        session.qrCode = null;

        io.to(`session_${sessionId}`).emit('auth_failure', `Failed: ${error.message}`);
        throw error;
    }

    return client;
}

/**
 * Initialize WhatsApp client with fallback minimal configuration
 *
 * @param {string} sessionId - The session identifier
 * @param {Object} session - The session object
 * @param {Object} sessionManager - The session manager instance (for formatMessage)
 * @param {Object} io - Socket.io server instance
 * @param {string} sessionDir - Directory path for session data (unused in fallback)
 * @param {string} fallbackSessionDir - Directory path for fallback session data
 * @returns {Promise<Client>} The initialized WhatsApp client
 * @throws {Error} If initialization fails or times out
 */
async function initializeClientFallback(sessionId, session, sessionManager, io, sessionDir, fallbackSessionDir) {
    console.log(`[FALLBACK] Starting minimal WhatsApp client for session: ${sessionId}`);

    // Use system temp directory for fallback
    const tempDir = os.tmpdir();
    const fallbackDir = fallbackSessionDir || path.join(tempDir, 'wweb_fallback', sessionId);

    try {
        await fs.mkdir(fallbackDir, { recursive: true });
        console.log(`[FALLBACK] Created session directory: ${fallbackDir}`);
    } catch (error) {
        console.log(`[FALLBACK] Directory creation failed: ${error.message}`);
        throw error;
    }

    // Get minimal Puppeteer options for fallback with stealth
    const fallbackPuppeteerOptions = getFallbackPuppeteerConfig();

    console.log(`[FALLBACK] Using Puppeteer with stealth plugin`);

    const fallbackClient = new Client({
        authStrategy: new LocalAuth({
            clientId: `fallback_${sessionId}`,
            dataPath: fallbackDir
        }),
        puppeteer: fallbackPuppeteerOptions
    });

    // Set up minimal event handlers
    fallbackClient.on('qr', async (qr) => {

        try {
            const qrCodeDataURL = await qrcode.toDataURL(qr);
            session.qrCode = qrCodeDataURL;

            // Emit to sockets
            const roomName = `session_${sessionId}`;
            const room = io.sockets.adapter.rooms.get(roomName);
            const socketCount = room ? room.size : 0;

            io.to(roomName).emit('qr', qrCodeDataURL);
        } catch (error) {
            console.error(`[FALLBACK] QR generation failed:`, error);
        }
    });

    fallbackClient.on('ready', () => {
        session.isReady = true;
        io.to(`session_${sessionId}`).emit('ready', { sessionId: sessionId });
    });

    fallbackClient.on('auth_failure', (msg) => {
        console.log(`[FALLBACK] Auth failure for session ${sessionId}:`, msg);
        io.to(`session_${sessionId}`).emit('auth_failure', msg);
    });

    // Real-time message listener
    fallbackClient.on('message', async (message) => {
        try {
            const formattedMessage = await sessionManager.formatMessage(message, sessionId, false, false);
            if (formattedMessage) {
                io.to(`session_${sessionId}`).emit('message', formattedMessage);
            }
        } catch (error) {
            console.log(`[FALLBACK] Error handling message: ${error.message}`);
        }
    });

    // Real-time message acknowledgment listener
    fallbackClient.on('message_ack', async (message, ack) => {
        try {
            io.to(`session_${sessionId}`).emit('message_ack', {
                messageId: message.id._serialized,
                ack: ack,
                timestamp: Date.now()
            });
        } catch (error) {
            console.log(`[FALLBACK] Error handling message ACK: ${error.message}`);
        }
    });

    // Real-time message revoke listener
    fallbackClient.on('message_revoke_everyone', async (message, revokedMessage) => {
        try {
            io.to(`session_${sessionId}`).emit('message_revoke', {
                messageId: message.id._serialized,
                revokedMessage: revokedMessage ? {
                    id: revokedMessage.id._serialized,
                    body: revokedMessage.body
                } : null,
                timestamp: Date.now()
            });
        } catch (error) {
            console.log(`[FALLBACK] Error handling message revoke: ${error.message}`);
        }
    });

    // Real-time reaction listener
    fallbackClient.on('message_reaction', async (reaction) => {
        try {
            io.to(`session_${sessionId}`).emit('message_reaction', {
                messageId: reaction.msgId._serialized,
                reaction: reaction.reaction,
                timestamp: reaction.timestamp,
                senderId: reaction.senderId
            });
        } catch (error) {
            console.log(`[FALLBACK] Error handling message reaction: ${error.message}`);
        }
    });

    session.client = fallbackClient;

    console.log(`[FALLBACK] Initializing with 20s timeout...`);

    const initPromise = fallbackClient.initialize();
    const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Fallback initialization timeout after 20 seconds')), 20000);
    });

    await Promise.race([initPromise, timeoutPromise]);
    console.log(`[FALLBACK] Initialization completed for session: ${sessionId}`);

    return fallbackClient;
}

module.exports = {
    initializeClient,
    initializeClientFallback
};
