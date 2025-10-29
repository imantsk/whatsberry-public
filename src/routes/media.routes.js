const { MessageMedia } = require('whatsapp-web.js');
const fs = require('fs').promises;
const path = require('path');

/**
 * Setup media-related routes
 * @param {Express} app - Express app instance
 * @param {Object} sessionManager - Session manager with sessions Map and middleware functions
 * @param {Object} audioConverter - Audio converter with conversion methods
 */
function setupMediaRoutes(app, sessionManager, audioConverter) {
    // Send media message (API key protected)
    app.post('/session/:sessionId/send-media', sessionManager.apiKeyMiddleware, async (req, res) => {
        try {
            const { sessionId } = req.params;
            const { to, media, caption = '', filename } = req.body;

            if (!sessionId) {
                return res.status(400).json({ error: 'Session ID required' });
            }

            if (!to) {
                return res.status(400).json({ error: 'Recipient (to) required' });
            }

            if (!media) {
                return res.status(400).json({ error: 'Media required' });
            }

            const session = sessionManager.sessions.get(sessionId);

            if (!session) {
                return res.status(404).json({ error: 'Session not found' });
            }

            if (!session.isReady || !session.client) {
                return res.status(400).json({ error: 'WhatsApp client not ready' });
            }

            // Perform health check before operation
            const isHealthy = await sessionManager.isSessionHealthy(sessionId);
            if (!isHealthy) {
                console.log(`⚠️ Session ${sessionId} failed health check before send media, triggering reconnection...`);
                sessionManager.reconnectSession(sessionId).catch(err => {
                    console.error(`🔧 Reconnection failed: ${err.message}`);
                });
                return res.status(503).json({
                    error: 'Session is not healthy, reconnection in progress. Please try again in a moment.',
                    reconnecting: true
                });
            }

            session.lastActivity = Date.now();

            // Handle both individual (@c.us) and group (@g.us) chats
            let chatId = to;
            if (!to.includes('@')) {
                chatId = `${to}@c.us`;
            }

            let messageMedia;
            if (media.startsWith('data:')) {
                const mimeType = media.split(';')[0].split(':')[1];
                const base64Data = media.split(',')[1];
                messageMedia = new MessageMedia(mimeType, base64Data, filename);
            } else {
                const buffer = await fs.readFile(media);
                const mimeType = audioConverter.getMimeType(media);
                messageMedia = new MessageMedia(
                    mimeType,
                    buffer.toString('base64'),
                    filename || path.basename(media)
                );
            }

            const result = await session.client.sendMessage(chatId, messageMedia, { caption });

            res.json({
                success: true,
                messageId: result.id._serialized,
                timestamp: result.timestamp
            });
        } catch (error) {
            console.error('Error sending media:', error);

            // Check if error indicates session is closed/disconnected
            if (error.message.includes('Evaluation failed') ||
                error.message.includes('Session closed') ||
                error.message.includes('Protocol error') ||
                error.message.includes('Target closed') ||
                error.message.includes('Connection lost')) {

                const { sessionId } = req.params;
                console.log(`Session ${sessionId} appears disconnected during send media, triggering reconnection...`);

                // Trigger immediate reconnection
                sessionManager.reconnectSession(sessionId).catch(reconnectError => {
                    console.error(`Immediate reconnection failed: ${reconnectError.message}`);
                });

                res.status(503).json({
                    error: 'Session disconnected, reconnection in progress. Please try again in a moment.',
                    reconnecting: true
                });
            } else {
                res.status(500).json({ error: error.message });
            }
        }
    });

    // Get media from message (API key protected)
    app.get('/session/:sessionId/message/:messageId/media', sessionManager.apiKeyMiddleware, async (req, res) => {
        try {
            const { sessionId, messageId } = req.params;
            const { download = 'false', format = 'original' } = req.query;

            if (!sessionId) {
                return res.status(400).json({ error: 'Session ID required' });
            }

            const session = sessionManager.sessions.get(sessionId);
            if (!session) {
                return res.status(404).json({ error: 'Session not found' });
            }

            if (!session.isReady || !session.client) {
                return res.status(400).json({ error: 'WhatsApp client not ready' });
            }

            session.lastActivity = Date.now();

            // Get the message by ID
            const message = await session.client.getMessageById(messageId);
            if (!message) {
                return res.status(404).json({ error: 'Message not found' });
            }

            if (!message.hasMedia) {
                return res.status(400).json({ error: 'Message does not contain media' });
            }

            // Download the media with timeout
            const downloadPromise = message.downloadMedia();
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Media download timeout after 30 seconds')), 30000);
            });

            const media = await Promise.race([downloadPromise, timeoutPromise]);

            if (!media) {
                return res.status(500).json({ error: 'Failed to download media' });
            }

            // Validate requested format
            if (!audioConverter.isValidFormat(format, media.mimetype)) {
                return res.status(400).json({
                    error: `Unsupported format '${format}' for media type '${media.mimetype}'`,
                    supportedFormats: audioConverter.getSupportedFormats(media.mimetype)
                });
            }

            // Convert base64 to buffer
            let mediaBuffer = Buffer.from(media.data, 'base64');
            let finalMimetype = media.mimetype;
            let finalFilename = media.filename || `media_${Date.now()}_${messageId.split('_')[0]}`;

            // Check if format conversion is requested
            if (format === 'mp3' && media.mimetype.startsWith('audio/') && media.mimetype !== 'audio/mpeg') {
                try {

                    // Convert audio to MP3
                    const convertedBuffer = await audioConverter.convertAudioToMp3(
                        mediaBuffer,
                        media.mimetype,
                        messageId
                    );

                    mediaBuffer = convertedBuffer;
                    finalMimetype = 'audio/mpeg';
                    finalFilename = finalFilename.replace(/\.[^.]+$/, '.mp3'); // Change extension to .mp3

                } catch (conversionError) {
                    console.error(`Audio conversion failed, sending original: ${conversionError.message}`);
                    // Continue with original audio if conversion fails
                }
            } else if (format !== 'original' && format !== 'mp3') {
                console.log(`Unsupported format requested: ${format}, sending original`);
            }

            // Set appropriate headers
            const disposition = download === 'true' ? 'attachment' : 'inline';

            res.set({
                'Content-Type': finalMimetype,
                'Content-Length': mediaBuffer.length,
                'Content-Disposition': `${disposition}; filename="${finalFilename}"`,
                'Cache-Control': 'public, max-age=3600', // Cache for 1 hour
                'X-Media-Type': message.type,
                'X-Message-ID': messageId,
                'X-Original-Mimetype': media.mimetype, // Include original type for reference
                'X-Requested-Format': format,
                'X-Converted': (format === 'mp3' && finalMimetype === 'audio/mpeg' && media.mimetype !== 'audio/mpeg') ? 'true' : 'false'
            });

            // Send the media buffer
            res.send(mediaBuffer);

        } catch (error) {
            console.error('Error downloading media:', error);

            // Check if error indicates session is closed/disconnected
            if (error.message.includes('Evaluation failed') ||
                error.message.includes('Session closed') ||
                error.message.includes('Protocol error') ||
                error.message.includes('Target closed') ||
                error.message.includes('Connection lost')) {

                const { sessionId } = req.params;
                console.log(`Session ${sessionId} appears disconnected, triggering reconnection...`);

                // Trigger immediate reconnection
                sessionManager.reconnectSession(sessionId).catch(reconnectError => {
                    console.error(`Immediate reconnection failed: ${reconnectError.message}`);
                });

                res.status(503).json({
                    error: 'Session disconnected, reconnection in progress. Please try again in a moment.',
                    reconnecting: true
                });
            } else {
                res.status(500).json({ error: error.message });
            }
        }
    });

    // Get media from chat by message index (API key protected)
    app.get('/session/:sessionId/chat/:chatId/media/:messageIndex', sessionManager.apiKeyMiddleware, async (req, res) => {
        try {
            const { sessionId, chatId, messageIndex } = req.params;
            const { download = 'false', limit = 50, format = 'original' } = req.query;

            const session = sessionManager.sessions.get(sessionId);
            if (!session) {
                return res.status(404).json({ error: 'Session not found' });
            }

            if (!session.isReady || !session.client) {
                return res.status(400).json({ error: 'WhatsApp client not ready' });
            }

            session.lastActivity = Date.now();

            // Get the chat and messages
            const chat = await session.client.getChatById(chatId);
            const messages = await chat.fetchMessages({ limit: parseInt(limit) });

            const messageIndexInt = parseInt(messageIndex);
            if (messageIndexInt < 0 || messageIndexInt >= messages.length) {
                return res.status(404).json({ error: 'Message index out of range' });
            }

            const message = messages[messageIndexInt];

            if (!message.hasMedia) {
                return res.status(400).json({ error: 'Message at index does not contain media' });
            }

            // Download the media with timeout
            const downloadPromise = message.downloadMedia();
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Media download timeout after 30 seconds')), 30000);
            });

            const media = await Promise.race([downloadPromise, timeoutPromise]);

            if (!media) {
                return res.status(500).json({ error: 'Failed to download media' });
            }

            // Validate requested format
            if (!audioConverter.isValidFormat(format, media.mimetype)) {
                return res.status(400).json({
                    error: `Unsupported format '${format}' for media type '${media.mimetype}'`,
                    supportedFormats: audioConverter.getSupportedFormats(media.mimetype)
                });
            }

            // Convert base64 to buffer
            let mediaBuffer = Buffer.from(media.data, 'base64');
            let finalMimetype = media.mimetype;
            let finalFilename = media.filename || `media_${Date.now()}_${messageIndex}`;

            // Check if format conversion is requested
            if (format === 'mp3' && media.mimetype.startsWith('audio/') && media.mimetype !== 'audio/mpeg') {
                try {

                    // Use message ID for caching if available, otherwise use chat+index
                    const cacheKey = message.id._serialized || `${chatId}_${messageIndex}`;

                    // Convert audio to MP3
                    const convertedBuffer = await audioConverter.convertAudioToMp3(
                        mediaBuffer,
                        media.mimetype,
                        cacheKey
                    );

                    mediaBuffer = convertedBuffer;
                    finalMimetype = 'audio/mpeg';
                    finalFilename = finalFilename.replace(/\.[^.]+$/, '.mp3'); // Change extension to .mp3

                    console.log(`🎵 Audio conversion successful: ${media.mimetype} → MP3`);

                } catch (conversionError) {
                    console.error(`Audio conversion failed, sending original: ${conversionError.message}`);
                    // Continue with original audio if conversion fails
                }
            } else if (format !== 'original' && format !== 'mp3') {
                console.log(`Unsupported format requested: ${format}, sending original`);
            }

            // Set appropriate headers
            const disposition = download === 'true' ? 'attachment' : 'inline';

            res.set({
                'Content-Type': finalMimetype,
                'Content-Length': mediaBuffer.length,
                'Content-Disposition': `${disposition}; filename="${finalFilename}"`,
                'Cache-Control': 'public, max-age=3600', // Cache for 1 hour
                'X-Media-Type': message.type,
                'X-Message-Index': messageIndex,
                'X-Chat-ID': chatId,
                'X-Original-Mimetype': media.mimetype, // Include original type for reference
                'X-Requested-Format': format,
                'X-Converted': (format === 'mp3' && finalMimetype === 'audio/mpeg' && media.mimetype !== 'audio/mpeg') ? 'true' : 'false'
            });

            // Send the media buffer
            res.send(mediaBuffer);

        } catch (error) {
            console.error('Error downloading media by index:', error);

            // Check if error indicates session is closed/disconnected
            if (error.message.includes('Evaluation failed') ||
                error.message.includes('Session closed') ||
                error.message.includes('Protocol error') ||
                error.message.includes('Target closed') ||
                error.message.includes('Connection lost')) {

                const { sessionId } = req.params;
                console.log(`Session ${sessionId} appears disconnected, triggering reconnection...`);

                // Trigger immediate reconnection
                sessionManager.reconnectSession(sessionId).catch(reconnectError => {
                    console.error(`Immediate reconnection failed: ${reconnectError.message}`);
                });

                res.status(503).json({
                    error: 'Session disconnected, reconnection in progress. Please try again in a moment.',
                    reconnecting: true
                });
            } else {
                res.status(500).json({ error: error.message });
            }
        }
    });

    // Get supported formats by mimetype (original endpoint)
    app.get('/formats/:mimetype', (req, res) => {
        try {
            const { mimetype } = req.params;
            const decodedMimetype = decodeURIComponent(mimetype);

            const supportedFormats = audioConverter.getSupportedFormats(decodedMimetype);

            res.json({
                inputMimetype: decodedMimetype,
                supportedFormats: supportedFormats,
                conversionInfo: {
                    mp3: decodedMimetype.startsWith('audio/') ? {
                        description: 'Convert to MP3 (Android 4.3 compatible)',
                        quality: '128kbps, 44.1kHz, Stereo',
                        usage: 'Add ?format=mp3 to media download URL'
                    } : null
                }
            });
        } catch (error) {
            console.error('Error getting supported formats:', error);
            res.status(500).json({ error: error.message });
        }
    });

    // Get supported formats for media conversion (alternative endpoint with query param)
    app.get('/media/:messageId/formats', (req, res) => {
        try {
            const { mimetype } = req.query;

            if (!mimetype) {
                return res.status(400).json({ error: 'Mimetype query parameter required' });
            }

            const decodedMimetype = decodeURIComponent(mimetype);

            const supportedFormats = audioConverter.getSupportedFormats(decodedMimetype);

            res.json({
                inputMimetype: decodedMimetype,
                supportedFormats: supportedFormats,
                conversionInfo: {
                    mp3: decodedMimetype.startsWith('audio/') ? {
                        description: 'Convert to MP3 (Android 4.3 compatible)',
                        quality: '128kbps, 44.1kHz, Stereo',
                        usage: 'Add ?format=mp3 to media download URL'
                    } : null
                }
            });
        } catch (error) {
            console.error('Error getting supported formats:', error);
            res.status(500).json({ error: error.message });
        }
    });

    // FFmpeg status and installation check
    app.get('/ffmpeg/status', (req, res) => {
        try {
            res.json({
                available: audioConverter.ffmpegAvailable,
                path: audioConverter.ffmpegPath,
                platform: process.platform,
                installationInstructions: {
                    'ubuntu/debian': 'sudo apt update && sudo apt install ffmpeg',
                    'centos/rhel': 'sudo yum install epel-release && sudo yum install ffmpeg',
                    'alpine': 'apk add ffmpeg',
                    'windows': 'Download from https://ffmpeg.org/download.html',
                    'macos': 'brew install ffmpeg',
                    'docker': 'Use a base image with FFmpeg pre-installed'
                },
                testCommand: process.platform === 'win32' ? 'where ffmpeg' : 'which ffmpeg',
                audioConversionEnabled: audioConverter.ffmpegAvailable
            });
        } catch (error) {
            console.error('Error getting FFmpeg status:', error);
            res.status(500).json({ error: error.message });
        }
    });

    // Audio conversion cache statistics
    app.get('/audio-cache/stats', (req, res) => {
        try {
            const now = Date.now();
            let totalCacheSize = 0;
            let expiredCount = 0;
            const cacheEntries = [];

            for (const [mediaId, cacheInfo] of audioConverter.audioConversionCache.entries()) {
                const isExpired = (now - cacheInfo.timestamp) > audioConverter.audioConversionTTL;
                if (isExpired) expiredCount++;

                totalCacheSize += cacheInfo.convertedSize || 0;

                cacheEntries.push({
                    mediaId: mediaId,
                    timestamp: new Date(cacheInfo.timestamp).toISOString(),
                    originalSize: cacheInfo.originalSize,
                    convertedSize: cacheInfo.convertedSize,
                    ageMinutes: Math.round((now - cacheInfo.timestamp) / 1000 / 60),
                    isExpired: isExpired
                });
            }

            res.json({
                totalEntries: audioConverter.audioConversionCache.size,
                expiredEntries: expiredCount,
                totalCacheSizeKB: Math.round(totalCacheSize / 1024),
                cacheTTLHours: audioConverter.audioConversionTTL / (1000 * 60 * 60),
                cacheDirectory: audioConverter.audioConversionDir,
                supportedFormats: [
                    'audio/ogg', 'audio/opus', 'audio/webm',
                    'audio/aac', 'audio/m4a', 'audio/wav', 'audio/flac'
                ],
                entries: cacheEntries.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
            });
        } catch (error) {
            console.error('Error getting audio cache stats:', error);
            res.status(500).json({ error: error.message });
        }
    });
}

module.exports = { setupMediaRoutes };
