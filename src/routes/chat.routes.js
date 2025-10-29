/**
 * Setup chat-related routes
 * @param {Express} app - Express app instance
 * @param {Object} sessionManager - Session manager with sessions Map and middleware functions
 * @param {Object} audioConverter - Audio converter instance (not used in chat routes but kept for consistency)
 */
function setupChatRoutes(app, sessionManager) {
    // Send text message (API key protected)
    app.post('/session/:sessionId/send-message', sessionManager.apiKeyMiddleware, async (req, res) => {
        try {
            const { sessionId } = req.params;
            const { to, message } = req.body;

            if (!sessionId) {
                return res.status(400).json({ error: 'Session ID required' });
            }

            if (!to) {
                return res.status(400).json({ error: 'Recipient (to) required' });
            }

            if (!message) {
                return res.status(400).json({ error: 'Message required' });
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
                console.log(`Session ${sessionId} failed health check before send message, triggering reconnection...`);
                sessionManager.reconnectSession(sessionId).catch(err => {
                    console.error(`Reconnection failed: ${err.message}`);
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
            const result = await session.client.sendMessage(chatId, message);

            res.json({
                success: true,
                messageId: result.id._serialized,
                timestamp: result.timestamp
            });
        } catch (error) {
            console.error('Error sending message:', error);

            // Check if error indicates session is closed/disconnected
            if (error.message.includes('Evaluation failed') ||
                error.message.includes('Session closed') ||
                error.message.includes('Protocol error') ||
                error.message.includes('Target closed') ||
                error.message.includes('Connection lost')) {

                const { sessionId } = req.params;
                console.log(`Session ${sessionId} appears disconnected during send message, triggering reconnection...`);

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

    // Get chats for session (API key protected)
    app.get('/session/:sessionId/chats', sessionManager.apiKeyMiddleware, async (req, res) => {
        try {
            const { sessionId } = req.params;
            const { includeProfilePics = 'true', limit, offset = '0' } = req.query;

            if (!sessionId) {
                return res.status(400).json({ error: 'Session ID required' });
            }

            const session = sessionManager.sessions.get(sessionId);

            if (!session) {
                console.log(`Available sessions: ${Array.from(sessionManager.sessions.keys()).join(', ')}`);
                return res.status(404).json({ error: 'Session not found' });
            }

            if (!session.isReady || !session.client) {
                return res.status(400).json({ error: 'WhatsApp client not ready' });
            }

            session.lastActivity = Date.now();

            // Add timeout to prevent hanging
            const getChatsWithTimeout = Promise.race([
                session.client.getChats(),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('Timeout getting chats')), 30000)
                )
            ]);

            let chats = await getChatsWithTimeout;

            // Apply pagination if requested
            const offsetNum = parseInt(offset);
            const limitNum = limit ? parseInt(limit) : chats.length;
            const paginatedChats = chats.slice(offsetNum, offsetNum + limitNum);

            const shouldIncludeProfilePics = includeProfilePics === 'true';

            // Format a single chat with aggressive timeouts
            const formatChat = async (chat) => {
                try {
                    let contact = null;
                    let profilePic = null;

                    // Only fetch contact and profile pic if requested
                    if (shouldIncludeProfilePics) {
                        // Fetch contact and profile pic in parallel with aggressive timeouts
                        try {
                            const contactPromise = Promise.race([
                                chat.getContact(),
                                new Promise((_, reject) =>
                                    setTimeout(() => reject(new Error('Contact timeout')), 800)
                                )
                            ]);
                            contact = await contactPromise;

                            // Immediately start fetching profile pic without waiting
                            if (contact) {
                                const profilePicPromise = Promise.race([
                                    contact.getProfilePicUrl(),
                                    new Promise((_, reject) =>
                                        setTimeout(() => reject(new Error('Profile pic timeout')), 600)
                                    )
                                ]);
                                profilePic = await profilePicPromise;
                            }
                        } catch (error) {
                            // Failed to get contact or profile pic, continue with basic info
                        }
                    }

                    return {
                        id: chat.id._serialized,
                        name: chat.name || (contact?.name) || (contact?.pushname) || (contact?.number) || 'Unknown',
                        isGroup: chat.isGroup,
                        unreadCount: chat.unreadCount,
                        timestamp: chat.timestamp,
                        profilePic: profilePic,
                        lastMessage: chat.lastMessage ? {
                            body: chat.lastMessage.body,
                            timestamp: chat.lastMessage.timestamp,
                            fromMe: chat.lastMessage.fromMe,
                            ack: chat.lastMessage.ack
                        } : null
                    };
                } catch (error) {
                    console.error(`Error formatting chat ${chat.id._serialized}:`, error.message);
                    // Return basic chat info if formatting fails
                    return {
                        id: chat.id._serialized,
                        name: chat.name || 'Unknown',
                        isGroup: chat.isGroup || false,
                        unreadCount: chat.unreadCount || 0,
                        timestamp: chat.timestamp || null,
                        profilePic: null,
                        lastMessage: chat.lastMessage ? {
                            body: chat.lastMessage.body || '',
                            timestamp: chat.lastMessage.timestamp || null,
                            fromMe: chat.lastMessage.fromMe || false,
                            ack: chat.lastMessage.ack
                        } : null
                    };
                }
            };

            // Process all chats in parallel
            const formattedChats = await Promise.all(paginatedChats.map(chat => formatChat(chat)));

            res.json({
                chats: formattedChats.filter(chat => chat !== null),
                total: chats.length,
                offset: offsetNum,
                limit: limitNum,
                hasMore: (offsetNum + limitNum) < chats.length
            });
        } catch (error) {
            console.error('Error getting chats:', error);

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

    // Mark chat as read (API key protected)
    app.post('/session/:sessionId/chat/:chatId/mark-read', sessionManager.apiKeyMiddleware, async (req, res) => {
        try {
            const { sessionId, chatId } = req.params;

            if (!sessionId) {
                return res.status(400).json({ error: 'Session ID required' });
            }

            if (!chatId) {
                return res.status(400).json({ error: 'Chat ID required' });
            }

            const session = sessionManager.sessions.get(sessionId);

            if (!session) {
                return res.status(404).json({ error: 'Session not found' });
            }

            if (!session.isReady || !session.client) {
                return res.status(400).json({ error: 'WhatsApp client not ready' });
            }

            session.lastActivity = Date.now();

            // Get the chat
            const chat = await session.client.getChatById(chatId);

            if (!chat) {
                return res.status(404).json({ error: 'Chat not found' });
            }

            // Mark all messages in the chat as seen
            await chat.sendSeen();

            res.json({
                success: true,
                chatId: chatId,
                message: 'Chat marked as read'
            });
        } catch (error) {
            console.error('Error marking chat as read:', error);

            // Check if error indicates session is closed/disconnected
            if (error.message.includes('Evaluation failed') ||
                error.message.includes('Session closed') ||
                error.message.includes('Protocol error') ||
                error.message.includes('Target closed') ||
                error.message.includes('Connection lost')) {

                const { sessionId } = req.params;
                console.log(`Session ${sessionId} appears disconnected during mark as read, triggering reconnection...`);

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

    // Get contacts (API key protected)
    app.get('/session/:sessionId/contacts', sessionManager.apiKeyMiddleware, async (req, res) => {
        try {
            const { sessionId } = req.params;
            const { includeProfilePics = 'true', limit, offset = '0' } = req.query;

            if (!sessionId) {
                return res.status(400).json({ error: 'Session ID required' });
            }

            const session = sessionManager.sessions.get(sessionId);

            if (!session) {
                console.log(`Available sessions: ${Array.from(sessionManager.sessions.keys()).join(', ')}`);
                return res.status(404).json({ error: 'Session not found' });
            }

            if (!session.isReady || !session.client) {
                return res.status(400).json({ error: 'WhatsApp client not ready' });
            }

            session.lastActivity = Date.now();

            // Add timeout to prevent hanging
            const getContactsWithTimeout = Promise.race([
                session.client.getContacts(),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('Timeout getting contacts')), 30000)
                )
            ]);

            let contacts = await getContactsWithTimeout;

            // Apply pagination if requested
            const offsetNum = parseInt(offset);
            const limitNum = limit ? parseInt(limit) : contacts.length;
            const paginatedContacts = contacts.slice(offsetNum, offsetNum + limitNum);

            const shouldIncludeProfilePics = includeProfilePics === 'true';

            // Format a single contact with aggressive timeouts
            const formatContact = async (contact) => {
                try {
                    let profilePic = null;

                    // Only fetch profile pic if explicitly requested
                    if (shouldIncludeProfilePics) {
                        try {
                            const profilePicPromise = Promise.race([
                                contact.getProfilePicUrl(),
                                new Promise((_, reject) =>
                                    setTimeout(() => reject(new Error('Profile pic timeout')), 600)
                                )
                            ]);
                            profilePic = await profilePicPromise;
                        } catch (error) {
                            // Profile pic not available or timeout
                        }
                    }

                    return {
                        id: contact.id._serialized,
                        name: contact.name || contact.pushname || 'Unknown',
                        number: contact.number,
                        isMyContact: contact.isMyContact || false,
                        profilePic: profilePic
                    };
                } catch (error) {
                    console.error(`Error formatting contact ${contact.id._serialized}:`, error.message);
                    // Return basic contact info if formatting fails
                    return {
                        id: contact.id._serialized,
                        name: contact.name || contact.pushname || 'Unknown',
                        number: contact.number || '',
                        isMyContact: contact.isMyContact || false,
                        profilePic: null
                    };
                }
            };

            // Process all contacts in parallel
            const formattedContacts = await Promise.all(paginatedContacts.map(contact => formatContact(contact)));

            res.json({
                contacts: formattedContacts.filter(contact => contact !== null),
                total: contacts.length,
                offset: offsetNum,
                limit: limitNum,
                hasMore: (offsetNum + limitNum) < contacts.length
            });
        } catch (error) {
            console.error('Error getting contacts:', error);

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

    // Get group participants (API key protected)
    app.get('/session/:sessionId/group/:groupId/participants', sessionManager.apiKeyMiddleware, async (req, res) => {
        try {
            const { sessionId, groupId } = req.params;
            console.log(`👥 Group participants requested for session: ${sessionId}, group: ${groupId}`);

            const session = sessionManager.sessions.get(sessionId);

            if (!session) {
                return res.status(404).json({ error: 'Session not found' });
            }

            if (!session.isReady || !session.client) {
                return res.status(400).json({ error: 'WhatsApp client not ready' });
            }

            session.lastActivity = Date.now();

            // Get the chat/group
            const chat = await session.client.getChatById(groupId);

            if (!chat) {
                return res.status(404).json({ error: 'Group not found' });
            }

            if (!chat.isGroup) {
                return res.status(400).json({ error: 'Chat is not a group' });
            }

            // Get participants
            const participants = chat.participants || [];

            // Format participants with contact info
            const formattedParticipants = await Promise.all(participants.map(async (participant) => {
                try {
                    const participantId = participant.id._serialized;
                    let contact = null;
                    let name = 'Unknown';
                    let number = participant.id.user;
                    let phoneId = null;

                    // Try to get contact info (handles both @c.us and @lid)
                    try {
                        contact = await session.client.getContactById(participantId);
                        name = contact.name || contact.pushname || contact.verifiedName || contact.number || 'Unknown';
                        number = contact.number || participant.id.user;
                    } catch (contactError) {
                        // If @lid format, also try getting the number-based contact
                        if (participantId.includes('@lid')) {
                            const phoneNumber = participant.id.user;
                            phoneId = `${phoneNumber}@c.us`;
                            try {
                                contact = await session.client.getContactById(phoneId);
                                name = contact.name || contact.pushname || contact.verifiedName || phoneNumber;
                                number = phoneNumber;
                            } catch (phoneError) {
                                name = phoneNumber;
                            }
                        }
                    }

                    // If original ID is @lid, provide the @c.us equivalent
                    if (participantId.includes('@lid')) {
                        phoneId = `${number}@c.us`;
                    }

                    return {
                        id: participantId,
                        phoneId: phoneId,
                        name: name,
                        number: number,
                        isAdmin: participant.isAdmin || false,
                        isSuperAdmin: participant.isSuperAdmin || false
                    };
                } catch (error) {
                    // If everything fails, return basic info
                    const participantId = participant.id._serialized;
                    const number = participant.id.user;
                    const phoneId = participantId.includes('@lid') ? `${number}@c.us` : null;

                    return {
                        id: participantId,
                        phoneId: phoneId,
                        name: number || 'Unknown',
                        number: number,
                        isAdmin: participant.isAdmin || false,
                        isSuperAdmin: participant.isSuperAdmin || false
                    };
                }
            }));

            res.json({
                groupId: groupId,
                groupName: chat.name,
                participants: formattedParticipants,
                participantCount: formattedParticipants.length
            });

        } catch (error) {
            console.error('Error getting group participants:', error);
            res.status(500).json({ error: error.message });
        }
    });

    // Get messages from chat (API key protected)
    app.get('/session/:sessionId/chat/:chatId/messages', sessionManager.apiKeyMiddleware, async (req, res) => {
        try {
            const { sessionId, chatId } = req.params;
            const { limit = '50', includeMedia = 'false', includeContacts = 'true' } = req.query;

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

            const chat = await session.client.getChatById(chatId);
            const messages = await chat.fetchMessages({ limit: parseInt(limit) });

            const shouldIncludeMedia = includeMedia === 'true';
            const shouldIncludeContacts = includeContacts === 'true';

            // Process all messages in parallel
            const formattedMessages = await Promise.all(
                messages.map(message =>
                    sessionManager.formatMessage(message, sessionId, shouldIncludeMedia, !shouldIncludeContacts)
                )
            );

            // Filter out any null results
            res.json({
                messages: formattedMessages.filter(msg => msg !== null)
            });
        } catch (error) {
            console.error('Error getting messages:', error);

            // Check if error indicates session is closed/disconnected
            if (error.message.includes('Evaluation failed') ||
                error.message.includes('Session closed') ||
                error.message.includes('Protocol error') ||
                error.message.includes('Target closed') ||
                error.message.includes('Connection lost')) {

                const { sessionId } = req.params;
                console.log(`Session ${sessionId} appears disconnected during get messages, triggering reconnection...`);

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
}

module.exports = { setupChatRoutes };
