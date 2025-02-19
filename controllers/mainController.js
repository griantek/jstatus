import { findUserByIdentifier } from '../services/dbService.js';
import { createWebDriver, executeInstructions } from '../services/seleniumService.js';
import { screenshotManager } from '../services/screenshotManager.js';
import { sendWhatsAppMessage, sendWhatsAppImage, decrypt, operationTracker, processedMessages } from '../utils/logger.js';
import { whatsappConfig } from '../config/dbConfig.js';
import PQueue from 'p-queue';
import { v4 as uuidv4 } from 'uuid';

const requestQueue = new PQueue({ concurrency: 1 }); // Fix P-Queue typo

// Add operation management
const manageOperation = async (operationFn, context) => {
  const operationId = uuidv4();
  operationTracker.startOperation(operationId, context.type);

  try {
    await operationFn();
    operationTracker.completeOperation(operationId);
  } catch (error) {
    operationTracker.completeOperation(operationId, 'failed', error);
    throw error;
  }
};

export const handleWebhookGet = (req, res) => {
  if (req.query['hub.verify_token'] === whatsappConfig.verifyToken) {
    res.status(200).send(req.query['hub.challenge']);
  } else {
    res.sendStatus(403);
  }
};

export const handleWebhookPost = async (req, res) => {
  try {
    const messageData = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!messageData) return res.sendStatus(400);

    const from = messageData.from;
    const messageId = messageData.id;

    // Check if message already processed
    if (processedMessages.has(messageId)) {
      console.log(`Message ${messageId} already processed.`);
      return res.sendStatus(200);
    }

    // Mark the message as processed
    processedMessages.add(messageId);

    if (messageData.type === 'text') {
      const username = messageData.text.body.trim();
      await processWhatsAppRequest(username, from, messageId);
    }

    res.sendStatus(200);
  } catch (error) {
    console.error('Webhook error:', error);
    res.sendStatus(500);
  }
};

const processWhatsAppRequest = async (username, from, messageId) => {
  try {
    // Send immediate acknowledgment
    await sendWhatsAppMessage(from, {
      messaging_product: "whatsapp",
      to: from,
      type: "text",
      text: { body: `✓ Received your request for: ${username}\nSearching records...` }
    });

    const rows = await findUserByIdentifier(username);
    
    if (!rows || rows.length === 0) {
      await sendWhatsAppMessage(from, {
        messaging_product: "whatsapp",
        to: from,
        type: "text",
        text: { body: "No account information found for the provided identifier. Please verify your Client Name or Email address and try again." }
      });
      return;
    }

    // Send match count before processing
    await sendWhatsAppMessage(from, {
      messaging_product: "whatsapp",
      to: from,
      type: "text",
      text: { body: `Found ${rows.length} matching journal(s).\nProcessing your request...` }
    });

    // Process each match
    for (const [index, row] of rows.entries()) {
      const match = {
        url: decrypt(row.url),
        username: decrypt(row.username),
        password: decrypt(row.password)
      };

      if (match.url && match.username && match.password) {
        const driver = await createWebDriver();
        try {
          await driver.get(match.url);
          await executeInstructions(driver, match.username, match.password, index + 1, match.url, from, username);
        } finally {
          await driver.quit();
        }
      }
    }

    // Send all captured screenshots
    await screenshotManager.sendToWhatsApp(from, username);

    // Send completion message
    await sendWhatsAppMessage(from, {
      messaging_product: "whatsapp",
      to: from,
      type: "text",
      text: { body: "All status updates have been sent." }
    });

  } catch (error) {
    console.error('Process WhatsApp request error:', error);
    await sendWhatsAppMessage(from, {
      messaging_product: "whatsapp",
      to: from,
      type: "text",
      text: { body: "An error occurred while processing your request. Please try again later." }
    });
  } finally {
    await screenshotManager.deleteUserFolder(username);
  }
};

const handleJournal = async (match, order, whatsappNumber, userId) => {
  const driver = await createWebDriver();
  try {
    await driver.get(match.url);
    await executeInstructions(
      driver,
      match.username,
      match.password,
      order,
      match.url,
      whatsappNumber,
      userId
    );
  } finally {
    await driver.quit();
  }
};

export const handleCapture = async (req, res) => {
  try {
    const { username } = req.body;
    if (!username) {
      return res.status(400).json({
        error: "Missing username parameter"
      });
    }

    const rows = await findUserByIdentifier(username);
    
    if (!rows || rows.length === 0) {
      return res.status(404).json({
        error: "Account not found",
        message: "No account information found for the provided identifier."
      });
    }

    const matches = rows.map(row => ({
      url: decrypt(row.url),
      username: decrypt(row.username),
      password: decrypt(row.password)
    })).filter(match => match.url && match.username && match.password);

    if (matches.length === 0) {
      return res.status(404).json({
        error: "Incomplete credentials",
        message: "Found account but credentials are incomplete."
      });
    }

    // Process each match
    for (const [index, match] of matches.entries()) {
      const driver = await createWebDriver();
      try {
        await driver.get(match.url);
        await executeInstructions(
          driver, 
          match.username, 
          match.password, 
          index + 1, 
          match.url, 
          whatsappConfig.defaultNumber,
          username
        );
      } finally {
        await driver.quit();
      }
    }

    res.status(200).json({
      message: "Capture process completed successfully",
      processedCount: matches.length
    });

  } catch (error) {
    console.error('Capture error:', error);
    res.status(500).json({ error: error.message });
  }
};

export const handleTestDecrypt = async (req, res) => {
  try {
    const { encryptedText } = req.body;
    if (!encryptedText) {
      return res.status(400).json({
        error: "Missing encryptedText in request body"
      });
    }

    const decrypted = decrypt(encryptedText);
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
};

export const handleCheckStatus = async (req, res) => {
  try {
    const { username, phone_number } = req.body;
    if (!username || !phone_number) {
      return res.status(400).json({
        error: "Missing parameters",
        message: "Both username and phone_number are required"
      });
    }

    await processWhatsAppRequest(username, phone_number, Date.now().toString());
    
    res.status(200).json({
      status: "success",
      message: "Status check initiated"
    });
  } catch (error) {
    res.status(500).json({
      error: 'Status check failed',
      message: error.message
    });
  }
};

export const handleCryptoInfo = (req, res) => {
  res.json({
    algorithm: whatsappConfig.algorithm,
    keyPresent: Boolean(whatsappConfig.key),
    ivPresent: Boolean(whatsappConfig.iv)
  });
};

export const handleHealthCheck = (req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString()
  });
};

const handleScreenshotRequest = async (username, whatsappNumber) => {
  const requestId = uuidv4();

  return requestQueue.add(async () => {
    try {
      console.log(`Processing request ${requestId} for user ${username}`);
      await screenshotManager.deleteUserFolder(username);

      const rows = await findUserByIdentifier(username);
      
      if (!rows || rows.length === 0) {
        await sendWhatsAppMessage(whatsappNumber, {
          messaging_product: "whatsapp",
          to: whatsappNumber,
          type: "text",
          text: { body: "No account information found..." }
        });
        return;
      }

      // Send match count
      await sendWhatsAppMessage(whatsappNumber, {
        messaging_product: "whatsapp",
        to: whatsappNumber,
        type: "text",
        text: { body: `Found ${rows.length} matching journal(s).\nProcessing...` }
      });

      let matches = rows.map(row => ({
        url: decrypt(row.url),
        username: decrypt(row.username),
        password: decrypt(row.password)
      })).filter(match => match.url && match.username && match.password);

      if (matches.length === 0) {
        await sendWhatsAppMessage(whatsappNumber, {
          messaging_product: "whatsapp",
          to: whatsappNumber,
          type: "text",
          text: { body: "Account found but credentials are incomplete." }
        });
        return;
      }

      for (const [index, match] of matches.entries()) {
        await handleJournal(match, index + 1, whatsappNumber, username);
      }

      await screenshotManager.sendToWhatsApp(whatsappNumber, username);
      await sendWhatsAppMessage(whatsappNumber, {
        messaging_product: "whatsapp",
        to: whatsappNumber,
        type: "text",
        text: { body: "All status updates have been sent." }
      });

    } catch (error) {
      console.error(`Error processing request ${requestId}:`, error);
      throw error;
    } finally {
      await screenshotManager.deleteUserFolder(username);
    }
  });
};

// Add status polling endpoint handler
export const handleStatusPoll = async (req, res) => {
  const { operationId } = req.params;
  const status = operationTracker.getOperationStatus(operationId);
  
  if (!status) {
    return res.status(404).json({
      error: 'Not found',
      message: 'Operation not found'
    });
  }

  res.json(status);
};

export { handleScreenshotRequest };
