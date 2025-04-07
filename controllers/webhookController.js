import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/Logger.js';
import { handleScreenshotRequest } from '../services/services.js';

export const webhookController = {
    // Webhook verification
    verifyWebhook: (req, res) => {
        console.log('WhatsApp webhook verification request received.');
        if (req.query['hub.verify_token'] === process.env.VERIFY_TOKEN) {
            res.status(200).send(req.query['hub.challenge']);
        } else {
            res.sendStatus(403);
        }
    },
    
    // Handle webhook messages
    handleWebhook: async (req, res, services) => {
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

            // Simulate a text message for retry requests
            if (messageData.type === 'interactive' && messageData.interactive?.type === 'button_reply') {
                const buttonId = messageData.interactive.button_reply.id;
                
                if (buttonId.startsWith('retry_')) {
                    const [_, retryAction, username, messageId] = buttonId.split('_');
                    
                    if (retryAction === 'yes') {
                        // Create a simulated text message request
                        await services.sendWhatsAppMessage(from, {
                            messaging_product: "whatsapp",
                            to: from,
                            type: "text",
                            text: { body: `✓ Retrying status check for ${username}...\nProcessing your request...` }
                        });
                        
                        // Use the same message handling logic
                        await handleScreenshotRequest(username, from);
                        
                    } else {
                        // Handle "No, thanks" response
                        await services.sendWhatsAppMessage(from, {
                            messaging_product: "whatsapp",
                            to: from,
                            type: "text",
                            text: { body: "Okay, please contact support if you need further assistance." }
                        });
                    }
                    return res.sendStatus(200);
                }

                const [action, username, messageId] = buttonId.split('_');
                // Rest of the feedback handling code...
                if (action === 'yes' || action === 'no') {
                    // Handle initial feedback
                    await logger.logFeedback({
                        userId: username,
                        whatsappNumber: messageData.from,
                        feedback: action === 'yes' ? 'positive' : 'negative',
                        messageId,
                        requestId: messageId
                    });

                    if (action === 'yes') {
                        await services.sendWhatsAppMessage(messageData.from, {
                            messaging_product: "whatsapp",
                            to: messageData.from,
                            type: "text",
                            text: { body: "Thank you for your feedback! We're glad we could help." }
                        });
                    } else {
                        // Send reprocess option with both Yes and No buttons
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
                                                id: `retry_yes_${username}_${messageId}`,
                                                title: "Yes, try again"
                                            }
                                        },
                                        {
                                            type: "reply",
                                            reply: {
                                                id: `retry_no_${username}_${messageId}`,
                                                title: "No, thanks"
                                            }
                                        }
                                    ]
                                }
                            }
                        });
                    }
                }
            } else if (messageData.type === 'text') {
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
    }
};
