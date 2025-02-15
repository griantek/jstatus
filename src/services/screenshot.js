import fs from 'fs';
import path from 'path';
import { config } from '../config/config.js';
import { WhatsAppService } from './whatsapp.js';

export class ScreenshotService {
  static activeScreenshots = new Set();
  static baseFolder = config.app.screenshotFolder;

  static async init() {
    if (!fs.existsSync(this.baseFolder)) {
      fs.mkdirSync(this.baseFolder, { recursive: true });
    }
  }

  static async capture(driver, description, sessionId = null) {
    try {
      const timestamp = new Date().toISOString().replace(/[-:.]/g, "");
      const safeDescription = description.replace(/[^a-zA-Z0-9]/g, '_');
      const filename = `${safeDescription}_${timestamp}.png`;
      
      const filepath = sessionId ? 
        path.join(this.baseFolder, sessionId, filename) :
        path.join(this.baseFolder, filename);

      // Ensure directory exists
      const dir = path.dirname(filepath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const image = await driver.takeScreenshot();
      fs.writeFileSync(filepath, image, 'base64');
      
      this.activeScreenshots.add(filepath);
      console.log(`Screenshot saved: ${filepath}`);
      
      return filepath;
    } catch (error) {
      console.error('Screenshot capture error:', error);
      throw error;
    }
  }

  static async sendToWhatsApp(whatsappNumber) {
    if (this.activeScreenshots.size === 0) {
      await WhatsAppService.sendText(whatsappNumber, "No new screenshots available.");
      return;
    }

    try {
      for (const screenshotPath of this.activeScreenshots) {
        const caption = `Status update: ${path.basename(screenshotPath, '.png')}`;
        await WhatsAppService.sendImage(whatsappNumber, screenshotPath, caption);
        fs.unlinkSync(screenshotPath);
      }
    } catch (error) {
      console.error('Error sending screenshots:', error);
      throw error;
    } finally {
      this.activeScreenshots.clear();
    }
  }

  static cleanup(sessionId = null) {
    for (const filepath of this.activeScreenshots) {
      try {
        if (fs.existsSync(filepath)) {
          fs.unlinkSync(filepath);
        }
      } catch (error) {
        console.error(`Error deleting ${filepath}:`, error);
      }
    }
    this.activeScreenshots.clear();

    if (sessionId) {
      const sessionFolder = path.join(this.baseFolder, sessionId);
      if (fs.existsSync(sessionFolder)) {
        fs.rmSync(sessionFolder, { recursive: true, force: true });
      }
    }
  }
}
