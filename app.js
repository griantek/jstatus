import express from 'express';
import { config } from './src/config/config.js';
import db from './src/services/database.js';
import { WhatsAppService } from './src/services/whatsapp.js';
import { JournalHandler } from './src/handlers/journalHandler.js';
import { ScreenshotService } from './src/services/screenshot.js';
import { SeleniumUtils } from './src/utils/selenium.js';
import { RequestQueue } from './src/services/queue.js';

const app = express();
app.use(express.json());

// Store processed message IDs
const processedMessages = new Set();

// Initialize services
ScreenshotService.init();

// Health check route
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    port: config.app.port
  });
});

// WhatsApp webhook routes
app.get('/webhook', (req, res) => {
  if (req.query['hub.verify_token'] === config.whatsapp.verifyToken) {
    res.status(200).send(req.query['hub.challenge']);
  } else {
    res.sendStatus(403);
  }
});

app.post('/webhook', async (req, res) => {
  try {
    const messageData = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!messageData) return res.sendStatus(400);

    if (processedMessages.has(messageData.id)) {
      return res.sendStatus(200);
    }
    processedMessages.add(messageData.id);

    if (messageData.type === 'text') {
      await JournalHandler.handleRequest(messageData.text.body.trim(), messageData.from);
    }

    res.sendStatus(200);
  } catch (error) {
    console.error('Webhook error:', error);
    res.sendStatus(500);
  }
});

// Status check endpoint
app.post('/check-status', async (req, res) => {
  try {
    const { username, phone_number } = req.body;
    if (!username || !phone_number) {
      return res.status(400).json({
        error: "Missing parameters",
        message: "Both username and phone_number are required"
      });
    }

    await JournalHandler.handleRequest(username, phone_number);
    
    res.status(200).json({
      status: "success",
      message: "Status check initiated",
      details: { username, phone: phone_number, timestamp: new Date().toISOString() }
    });
  } catch (error) {
    res.status(500).json({ error: 'Status check failed', message: error.message });
  }
});

// Cleanup on shutdown
process.on('SIGINT', async () => {
  await ScreenshotService.cleanup();
  await db.close();
  process.exit();
});

// Start server
app.listen(config.app.port, () => {
  console.log(`Server running on port ${config.app.port}`);
});
