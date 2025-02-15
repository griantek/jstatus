import express from 'express';
import { JournalHandler } from '../handlers/journalHandler.js';
import { WhatsAppService } from '../services/whatsapp.js';
import { EncryptionService } from '../services/encryption.js';
import { RequestQueue } from '../services/queue.js';
import { DatabaseService } from '../services/database.js';

const router = express.Router();

// WhatsApp webhook verification
router.get('/webhook', (req, res) => {
  if (req.query['hub.verify_token'] === process.env.VERIFY_TOKEN) {
    res.status(200).send(req.query['hub.challenge']);
  } else {
    res.sendStatus(403);
  }
});

// Add request tracking
const processedRequests = new Set();

// WhatsApp message handler
router.post('/webhook', async (req, res) => {
  try {
    const messageData = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!messageData) return res.sendStatus(400);

    // Prevent duplicate processing
    if (processedRequests.has(messageData.id)) {
      return res.sendStatus(200);
    }
    processedRequests.add(messageData.id);

    // Add to queue
    await RequestQueue.add(messageData.from, async () => {
      await JournalHandler.handleRequest(
        messageData.text.body.trim(),
        messageData.from
      );
    });

    res.sendStatus(200);
  } catch (error) {
    console.error('Webhook error:', error);
    res.sendStatus(500);
  }
});

// Manual status check endpoint
router.post('/check-status', async (req, res) => {
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
      message: "Status check initiated"
    });
  } catch (error) {
    console.error('Status check error:', error);
    res.status(500).json({ 
      error: 'Status check failed', 
      message: error.message 
    });
  }
});

// Decryption test endpoint
router.post('/test-decrypt', async (req, res) => {
  try {
    const { encryptedText } = req.body;
    if (!encryptedText) {
      return res.status(400).json({
        error: "Missing encryptedText in request body"
      });
    }

    const decrypted = EncryptionService.decrypt(encryptedText);
    res.json({
      input: encryptedText,
      decrypted: decrypted
    });
  } catch (error) {
    res.status(500).json({
      error: 'Decryption failed',
      message: error.message
    });
  }
});

// Health check endpoint
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString()
  });
});

// Crypto info endpoint
router.get('/crypto-info', (req, res) => {
  res.json({
    nodeVersion: process.version,
    opensslVersion: process.versions.openssl,
    algorithm: process.env.ENCRYPTION_ALGORITHM,
    keyPresent: Boolean(process.env.ENCRYPTION_KEY),
    ivPresent: Boolean(process.env.ENCRYPTION_IV)
  });
});

// Screenshot list endpoint
router.get('/screenshots/:sessionId?', (req, res) => {
  try {
    const sessionId = req.params.sessionId;
    const screenshots = screenShotManager.listScreenshots(sessionId);
    res.json({ screenshots });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to list screenshots',
      message: error.message
    });
  }
});

export default router;
