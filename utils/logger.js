import crypto from 'crypto';
import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs';
import { performance } from 'perf_hooks';
import { cryptoConfig, whatsappConfig } from '../config/dbConfig.js';

const decrypt = (text) => {
  try {
    if (!text) return '';
    const encryptedBytes = Buffer.from(text, 'hex');
    const decipher = crypto.createDecipheriv(
      cryptoConfig.algorithm,
      cryptoConfig.key,
      cryptoConfig.iv
    );
    decipher.setAutoPadding(false);
    
    let decrypted = decipher.update(encryptedBytes);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    
    while (decrypted.length > 0 && decrypted[decrypted.length - 1] === 32) {
      decrypted = decrypted.slice(0, -1);
    }
    
    return decrypted.toString('utf8');
  } catch (error) {
    console.error('Decryption error:', error);
    return text;
  }
};

export const logEnvironmentVariables = () => {
  console.log('\n YOU ARE RUNNING ON BRANCH MAIN \n');
  console.log('\nEnvironment Variables Status:');
  console.log('============================');
  console.log('WhatsApp Configuration:');
  console.log('WHATSAPP_PHONE_NUMBER_ID:', process.env.WHATSAPP_PHONE_NUMBER_ID ? '✓ Loaded' : '✗ Missing');
  console.log('WHATSAPP_TOKEN:', process.env.WHATSAPP_TOKEN ? '✓ Loaded' : '✗ Missing');
  console.log('VERIFY_TOKEN:', process.env.VERIFY_TOKEN ? '✓ Loaded' : '✗ Missing');

  console.log('\nEncryption Configuration:');
  console.log('ENCRYPTION_ALGORITHM:', process.env.ENCRYPTION_ALGORITHM ? '✓ Loaded' : '✗ Missing');
  console.log('ENCRYPTION_KEY:', process.env.ENCRYPTION_KEY ? '✓ Loaded' : '✗ Missing');
  console.log('ENCRYPTION_IV:', process.env.ENCRYPTION_IV ? '✓ Loaded' : '✗ Missing');

  console.log('\nApplication Configuration:');
  console.log('PORT:', process.env.PORT ? '✓ Loaded' : '✗ Missing');
  console.log('SCREENSHOT_FOLDER:', process.env.SCREENSHOT_FOLDER ? '✓ Loaded' : '✗ Missing');
  console.log('CHROME_DRIVER_PATH:', process.env.CHROME_DRIVER_PATH ? '✓ Loaded' : '✗ Missing');
  console.log('DEFAULT_WHATSAPP_NUMBER:', process.env.DEFAULT_WHATSAPP_NUMBER ? '✓ Loaded' : '✗ Missing');
  console.log('DB_PATH:', process.env.DB_PATH ? '✓ Loaded' : '✗ Missing');
  console.log('============================\n');
};

const sendWhatsAppMessage = async (to, message) => {
  try {
    await axios.post(
      `https://graph.facebook.com/v21.0/${whatsappConfig.phoneNumberId}/messages`,
      message,
      {
        headers: {
          'Authorization': `Bearer ${whatsappConfig.token}`,
          'Content-Type': 'application/json'
        }
      }
    );
  } catch (error) {
    console.error('WhatsApp message error:', error);
    throw error;
  }
};

const sendWhatsAppImage = async (to, imagePath, caption) => {
  try {
    const mediaId = await uploadWhatsAppMedia(imagePath);
    const message = {
      messaging_product: "whatsapp",
      to: to,
      type: "image",
      image: { id: mediaId, caption: caption || '' }
    };
    await sendWhatsAppMessage(to, message);
  } catch (error) {
    console.error('WhatsApp image error:', error);
    throw error;
  }
};

const uploadWhatsAppMedia = async (imagePath) => {
  try {
    const formData = new FormData();
    formData.append('file', fs.createReadStream(imagePath));
    formData.append('messaging_product', 'whatsapp');

    const response = await axios.post(
      `https://graph.facebook.com/v21.0/${whatsappConfig.phoneNumberId}/media`,
      formData,
      {
        headers: {
          ...formData.getHeaders(),
          'Authorization': `Bearer ${whatsappConfig.token}`
        }
      }
    );

    return response.data.id;
  } catch (error) {
    console.error('Media upload error:', error);
    throw error;
  }
};

// Additional utility functions for logging and performance tracking
export const performanceLogger = {
  timers: new Map(),

  start(label) {
    this.timers.set(label, performance.now());
  },

  end(label) {
    const startTime = this.timers.get(label);
    if (!startTime) {
      console.warn(`No timer found for: ${label}`);
      return null;
    }
    const duration = performance.now() - startTime;
    this.timers.delete(label);
    return duration;
  },

  log(label) {
    const duration = this.end(label);
    if (duration) {
      console.log(`${label} took ${duration.toFixed(2)}ms`);
    }
  }
};

export const errorLogger = {
  logError(error, context = '') {
    const timestamp = new Date().toISOString();
    const errorDetails = {
      timestamp,
      context,
      message: error.message,
      stack: error.stack,
      type: error.name
    };
    console.error('Error occurred:', errorDetails);
    return errorDetails;
  },

  async logToWhatsApp(error, whatsappNumber) {
    const errorDetails = this.logError(error);
    try {
      await sendWhatsAppMessage(whatsappNumber, {
        messaging_product: "whatsapp",
        to: whatsappNumber,
        type: "text",
        text: { 
          body: `Error occurred: ${errorDetails.message}\nTimestamp: ${errorDetails.timestamp}`
        }
      });
    } catch (whatsappError) {
      console.error('Failed to send error to WhatsApp:', whatsappError);
    }
  }
};

// Add structured error logging
export const systemLogger = {
  errors: new Map(),
  
  logSystemError(component, error) {
    const errorLog = {
      timestamp: new Date().toISOString(),
      component,
      message: error.message,
      stack: error.stack,
      count: 1
    };

    const key = `${component}:${error.message}`;
    const existing = this.errors.get(key);
    
    if (existing) {
      existing.count++;
      existing.lastOccurrence = errorLog.timestamp;
    } else {
      this.errors.set(key, errorLog);
    }

    // Log to console
    console.error(`[${component}] ${error.message}`);
    
    // Cleanup old errors periodically
    this.cleanupOldErrors();
  },

  cleanupOldErrors() {
    const TWO_HOURS = 2 * 60 * 60 * 1000;
    const now = Date.now();
    
    for (const [key, error] of this.errors.entries()) {
      const errorTime = new Date(error.timestamp).getTime();
      if (now - errorTime > TWO_HOURS) {
        this.errors.delete(key);
      }
    }
  },

  getSystemStatus() {
    return {
      totalErrors: this.errors.size,
      recentErrors: Array.from(this.errors.values())
        .filter(e => Date.now() - new Date(e.timestamp).getTime() < 30 * 60 * 1000)
    };
  }
};

// Enhanced WhatsApp messaging utilities
export const whatsappHelper = {
  async sendTemplate(to, templateName, variables) {
    try {
      await sendWhatsAppMessage(to, {
        messaging_product: "whatsapp",
        to,
        type: "template",
        template: {
          name: templateName,
          language: { code: "en" },
          components: variables
        }
      });
    } catch (error) {
      console.error('Template message error:', error);
      throw error;
    }
  },

  async sendBulkMessages(numbers, message) {
    const results = await Promise.allSettled(
      numbers.map(number => sendWhatsAppMessage(number, message))
    );
    return results.map((result, index) => ({
      number: numbers[index],
      status: result.status,
      error: result.reason
    }));
  },

  async sendMultipleImages(to, imagePaths, baseCaption) {
    for (const [index, imagePath] of imagePaths.entries()) {
      try {
        const caption = `${baseCaption} (${index + 1}/${imagePaths.length})`;
        await sendWhatsAppImage(to, imagePath, caption);
        await new Promise(resolve => setTimeout(resolve, 1000)); // 1s delay between sends
      } catch (error) {
        console.error(`Failed to send image ${imagePath}:`, error);
      }
    }
  }
};

export const processedMessages = new Set();

export const cleanupOldMessages = () => {
  const ONE_HOUR = 60 * 60 * 1000;
  const now = Date.now();
  
  for (const messageId of processedMessages) {
    const [, timestamp] = messageId.split('_');
    if (now - Number(timestamp) > ONE_HOUR) {
      processedMessages.delete(messageId);
    }
  }
};

// Set up periodic cleanup
setInterval(cleanupOldMessages, 15 * 60 * 1000); // Every 15 minutes

export const messageTracker = {
  messageQueue: new Map(),
  
  addMessage(messageId, data) {
    this.messageQueue.set(messageId, {
      ...data,
      timestamp: Date.now()
    });
  },
  
  getMessage(messageId) {
    return this.messageQueue.get(messageId);
  },
  
  removeMessage(messageId) {
    this.messageQueue.delete(messageId);
  },
  
  cleanupOldMessages() {
    const MAX_AGE = 24 * 60 * 60 * 1000; // 24 hours
    const now = Date.now();
    
    for (const [messageId, data] of this.messageQueue.entries()) {
      if (now - data.timestamp > MAX_AGE) {
        this.messageQueue.delete(messageId);
      }
    }
  }
};

// Set up periodic message cleanup
setInterval(() => messageTracker.cleanupOldMessages(), 60 * 60 * 1000); // Every hour

// Add operation tracking
export const operationTracker = {
  operations: new Map(),

  startOperation(operationId, type) {
    this.operations.set(operationId, {
      type,
      startTime: Date.now(),
      status: 'in_progress'
    });
  },

  completeOperation(operationId, status = 'completed', error = null) {
    const operation = this.operations.get(operationId);
    if (operation) {
      operation.status = status;
      operation.endTime = Date.now();
      operation.duration = operation.endTime - operation.startTime;
      if (error) operation.error = error;
    }
  },

  getOperationStatus(operationId) {
    return this.operations.get(operationId);
  }
};

// Export the enhanced utilities
export { sendWhatsAppMessage, sendWhatsAppImage, decrypt };
