import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/Logger.js';
import { handleScreenshotRequest, processRows } from '../services/services.js';

export function setupRoutes(app, services) {
    // Health check route
    app.get('/', (req, res) => {
        res.status(200).json({
            status: 'ok',
            message: 'Server is running',
            timestamp: new Date().toISOString(),
            port: process.env.PORT
        });
    });

    // WhatsApp webhook verification
    app.get('/webhook', (req, res) => {
        console.log('WhatsApp webhook verification request received.');
        if (req.query['hub.verify_token'] === process.env.VERIFY_TOKEN) {
            res.status(200).send(req.query['hub.challenge']);
        } else {
            res.sendStatus(403);
        }
    });

    // WhatsApp webhook
    app.post('/webhook', async (req, res) => {
        const requestId = uuidv4();
        const startTime = new Date();
        
        try {
            const messageData = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
            if (!messageData) return res.sendStatus(400);

            const from = messageData.from;
            const messageId = messageData.id;

            // Start logging request
            await logger.logUserRequest({
                requestId,
                from,
                searchQuery: messageData.text?.body,
                startTime: startTime.toISOString(),
                status: 'started'
            });

            // Check for duplicate messages
            if (services.processedMessages.has(messageId)) {
                console.log(`Message ${messageId} already processed.`);
                return res.sendStatus(200);
            }
            services.processedMessages.add(messageId);

            if (messageData.type === 'text') {
                const username = messageData.text.body.trim();
                
                // Process the request
                await handleScreenshotRequest(username, from);
                
                const endTime = new Date();
                const duration = (endTime - startTime) / 1000;

                await logger.logUserRequest({
                    requestId,
                    status: 'completed',
                    completionTime: endTime.toISOString(),
                    totalDuration: duration
                });
            }

            // Handle interactive messages (feedback)
            if (messageData.type === 'interactive' && messageData.interactive?.type === 'button_reply') {
                const buttonId = messageData.interactive.button_reply.id;
                const [feedback, username, messageId] = buttonId.split('_');
                
                await logger.logFeedback({
                    userId: username,
                    whatsappNumber: messageData.from,
                    feedback: feedback === 'yes' ? 'positive' : 'negative',
                    messageId,
                    requestId: messageId
                });

                if (feedback === 'yes') {
                    await services.sendWhatsAppMessage(messageData.from, {
                        messaging_product: "whatsapp",
                        to: messageData.from,
                        type: "text",
                        text: { body: "Thank you for your feedback! We're glad we could help." }
                    });
                } else {
                    // Send reprocess option
                    await services.sendWhatsAppMessage(messageData.from, {
                        messaging_product: "whatsapp",
                        to: messageData.from,
                        type: "interactive",
                        interactive: {
                            type: "button",
                            body: {
                                text: "Would you like us to try checking the status again?"
                            },
                            action: {
                                buttons: [
                                    {
                                        type: "reply",
                                        reply: {
                                            id: `retry_${username}_${messageId}`,
                                            title: "Yes, try again"
                                        }
                                    }
                                ]
                            }
                        }
                    });
                }
            } else if (messageData.type === 'interactive' && 
                      messageData.interactive.button_reply.id.startsWith('retry_')) {
                const [_, username, messageId] = messageData.interactive.button_reply.id.split('_');
                // Reprocess the request
                await services.reprocessRequest(username, messageData.from);
            }

            res.sendStatus(200);
        } catch (error) {
            const endTime = new Date();
            const duration = (endTime - startTime) / 1000;

            await logger.logUserRequest({
                requestId,
                status: 'error',
                error: error.message,
                completionTime: endTime.toISOString(),
                totalDuration: duration
            });
            console.error('Webhook error:', error);
            res.sendStatus(500);
        }
    });

    // Capture route
    app.post("/capture", async (req, res) => {
        try {
            const { username } = req.body;
            if (!username) {
                return res.status(400).json({
                    error: "Missing required parameter. Please provide username"
                });
            }

            // Query database
            services.db.all(
                "SELECT Journal_Link as url, Username as username, Password as password FROM journal_data WHERE Personal_Email = ?",
                [username],
                async (err, emailRows) => {
                    if (err) {
                        return res.status(500).json({ error: "Database error" });
                    }

                    if (emailRows?.length > 0) {
                        await processRows(emailRows, res);
                        return;
                    }

                    // Try Client_Name if no email match
                    services.db.all(
                        "SELECT Journal_Link as url, Username as username, Password as password FROM journal_data WHERE Client_Name = ?",
                        [username],
                        async (err, clientRows) => {
                            if (err) {
                                return res.status(500).json({ error: "Database error" });
                            }
                            await processRows(clientRows, res);
                        }
                    );
                }
            );
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // Test decrypt route
    app.post("/test-decrypt", async (req, res) => {
        try {
            const { encryptedText } = req.body;
            if (!encryptedText) {
                return res.status(400).json({ error: "Missing encryptedText in request body" });
            }

            const decrypted = services.decrypt(encryptedText);
            res.json({
                input: encryptedText,
                decrypted: decrypted,
                config: {
                    algorithm: services.algorithm,
                    keyLength: services.key.length,
                    ivLength: services.iv.length
                }
            });
        } catch (error) {
            res.status(500).json({
                error: 'Decryption failed',
                message: error.message
            });
        }
    });

    // Status check route
    app.post("/check-status", async (req, res) => {
        try {
            const { username, phone_number } = req.body;
            if (!username || !phone_number) {
                return res.status(400).json({
                    error: "Missing parameters",
                    message: "Both username and phone_number are required"
                });
            }

            await handleScreenshotRequest(username, phone_number);
            res.status(200).json({
                status: "success",
                message: "Status check initiated",
                details: {
                    username,
                    phone: phone_number,
                    timestamp: new Date().toISOString()
                }
            });
        } catch (error) {
            res.status(500).json({
                error: 'Status check failed',
                message: error.message
            });
        }
    });

    // Crypto info route
    app.get('/crypto-info', (req, res) => {
        res.json({
            nodeVersion: process.version,
            opensslVersion: process.versions.openssl,
            algorithm: services.algorithm,
            keyLength: services.key.length,
            ivLength: services.iv.length,
            environment: {
                algorithm: process.env.ENCRYPTION_ALGORITHM,
                keyPresent: Boolean(process.env.ENCRYPTION_KEY),
                ivPresent: Boolean(process.env.ENCRYPTION_IV)
            }
        });
    });
}
