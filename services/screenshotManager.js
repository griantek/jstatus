import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { seleniumConfig } from '../config/dbConfig.js';
import { sendWhatsAppImage, sendWhatsAppMessage } from '../utils/logger.js';

export const screenshotManager = {
  baseFolder: seleniumConfig.screenshotFolder,
  sessions: new Map(),

  async init() {
    if (!fs.existsSync(this.baseFolder)) {
      fs.mkdirSync(this.baseFolder, { recursive: true });
    }
  },

  getUserFolder(userId) {
    const userFolder = path.join(this.baseFolder, userId.replace(/[^a-zA-Z0-9]/g, '_'));
    if (!fs.existsSync(userFolder)) {
      fs.mkdirSync(userFolder, { recursive: true });
    }
    return userFolder;
  },

  async capture(driver, description, userId) {
    try {
      const folder = this.getUserFolder(userId);
      const timestamp = new Date().toISOString().replace(/[-:.]/g, "");
      const filename = `${description.replace(/[^a-zA-Z0-9]/g, '_')}_${timestamp}.png`;
      const filepath = path.join(folder, filename);

      const image = await driver.takeScreenshot();
      await fs.promises.writeFile(filepath, image, 'base64');

      this.sessions.set(userId, {
        folder,
        screenshots: [...(this.sessions.get(userId)?.screenshots || []), filepath]
      });

      return filepath;
    } catch (error) {
      console.error('Screenshot capture error:', error);
      throw error;
    }
  },

  async sendToWhatsApp(whatsappNumber, userId) {
    const session = this.sessions.get(userId);
    if (!session?.screenshots?.length) {
      await sendWhatsAppMessage(whatsappNumber, {
        messaging_product: "whatsapp",
        to: whatsappNumber,
        type: "text",
        text: { body: "No screenshots available." }
      });
      return;
    }

    for (const screenshot of session.screenshots) {
      try {
        await sendWhatsAppImage(whatsappNumber, screenshot);
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        console.error(`Error sending screenshot ${screenshot}:`, error);
      }
    }
  },

  async deleteUserFolder(userId) {
    try {
      const folder = this.getUserFolder(userId);
      if (fs.existsSync(folder)) {
        await fs.promises.rm(folder, { recursive: true, force: true });
      }
      this.sessions.delete(userId);
    } catch (error) {
      console.error(`Error deleting folder for ${userId}:`, error);
    }
  },

  async clearAllScreenshots() {
    try {
      const files = await fs.promises.readdir(this.baseFolder);
      for (const file of files) {
        const filepath = path.join(this.baseFolder, file);
        await fs.promises.rm(filepath, { recursive: true, force: true });
      }
    } catch (error) {
      console.error('Error clearing screenshots:', error);
    }
  }
};
