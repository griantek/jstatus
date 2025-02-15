import { Builder, By, Key } from 'selenium-webdriver';
import { SeleniumUtils } from '../utils/selenium.js';
import { ScreenshotService } from '../services/screenshot.js';
import { WhatsAppService } from '../services/whatsapp.js';
import { EncryptionService } from '../services/encryption.js';
import DatabaseService from '../services/database.js';
import fs from 'fs';
import path from 'path';
import { config } from '../config/config.js';

export class JournalHandler {
  static async handleRequest(username, whatsappNumber) {
    const sessionId = `${whatsappNumber}_${Date.now()}`;
    let driver = null;

    try {
      // Find user data
      const rows = await DatabaseService.findUser(username);
      if (!rows || rows.length === 0) {
        await WhatsAppService.sendText(whatsappNumber, 
          "No account information found. Please verify your Client Name or Email address."
        );
        return;
      }

      // Process credentials
      const matches = rows.map(row => ({
        url: EncryptionService.decrypt(row.url),
        username: EncryptionService.decrypt(row.username),
        password: EncryptionService.decrypt(row.password)
      })).filter(match => match.url && match.username && match.password);

      if (matches.length === 0) {
        await WhatsAppService.sendText(whatsappNumber, 
          "Found your account, but credentials are incomplete. Please contact support."
        );
        return;
      }

      // Process each journal
      for (const [index, match] of matches.entries()) {
        driver = await SeleniumUtils.createDriver(sessionId);
        try {
          await this.processJournal(driver, match, index + 1, whatsappNumber);
        } finally {
          if (driver) {
            await driver.quit();
            driver = null;
          }
        }
      }

      await WhatsAppService.sendText(whatsappNumber, 
        "Status check completed for all journals."
      );

    } catch (error) {
      console.error('Journal handling error:', error);
      await WhatsAppService.sendText(whatsappNumber,
        "An error occurred while checking journal status. Please try again later."
      );
    } finally {
      if (driver) {
        await driver.quit();
      }
      ScreenshotService.cleanup(sessionId);
    }
  }

  static async processJournal(driver, match, order, whatsappNumber) {
    const { url, username, password } = match;
    
    try {
      await driver.get(url);
      await driver.sleep(5000);

      // Load and execute instructions
      const instructions = await this.loadInstructions(url);
      await this.executeInstructions(driver, instructions, {
        username,
        password,
        order,
        whatsappNumber
      });

    } catch (error) {
      console.error(`Error processing journal ${url}:`, error);
      await ScreenshotService.capture(driver, `error_${order}`, whatsappNumber);
    }
  }

  static async loadInstructions(url) {
    const keysMap = {
      'manuscriptcentral': 'manus_KEYS.txt',
      'editorialmanager': 'edito_KEYS.txt',
      'tandfonline': 'tandf_KEYS.txt',
      'taylorfrancis': 'taylo_KEYS.txt',
      'cgscholar': 'cgsch_KEYS.txt',
      'thescipub': 'thesc_KEYS.txt',
      'wiley': 'wiley_KEYS.txt',
      'periodicos': 'perio_KEYS.txt',
      'tspsubmission': 'tspsu_KEYS.txt',
      'springernature': 'springer_KEYS.txt'
    };

    const domain = Object.keys(keysMap).find(key => url.includes(key));
    if (!domain) {
      throw new Error(`No instruction file found for URL: ${url}`);
    }

    const keysFile = path.join('keys', keysMap[domain]);
    return fs.readFileSync(keysFile, 'utf-8').split('\n');
  }

  static async executeInstructions(driver, instructions, data) {
    const { username, password, order, whatsappNumber } = data;
    const foundTexts = new Set();

    for (const instruction of instructions) {
      const trimmed = instruction.trim();
      
      if (trimmed === "CHKSTS") {
        await this.checkStatus(driver, order, foundTexts, whatsappNumber);
        continue;
      }

      await SeleniumUtils.executeInstruction(driver, trimmed, { username, password });
    }
  }

  static async checkStatus(driver, order, foundTexts, whatsappNumber) {
    const currentUrl = await driver.getCurrentUrl();
    
    if (currentUrl.includes('editorialmanager')) {
      await this.checkEditorialManagerStatus(driver, order, foundTexts, whatsappNumber);
    } else {
      // Default status check
      const statusElements = await driver.findElements(By.css(
        '.status, .manuscript-status, .submission-status, .paper-status'
      ));

      for (const element of statusElements) {
        const text = await element.getText();
        if (text && !foundTexts.has(text)) {
          foundTexts.add(text);
          await ScreenshotService.capture(driver, `status_${text}`, whatsappNumber);
        }
      }
    }
  }

  static async checkEditorialManagerStatus(driver, order, foundTexts, whatsappNumber) {
    const textCollection = [
      "Submissions Sent Back to Author",
      "Incomplete Submissions",
      "Submissions Waiting for Author's Approval",
      "Submissions Being Processed",
      "Submissions Needing Revision",
      "Revisions Sent Back to Author",
      "Incomplete Submissions Being Revised",
      "Revisions Being Processed",
      "Submissions with a Decision"
    ];

    for (const text of textCollection) {
      const element = await SeleniumUtils.tabUntilMatch(driver, text);
      if (element && !foundTexts.has(text)) {
        foundTexts.add(text);
        await ScreenshotService.capture(driver, `em_${text}`, whatsappNumber);
      }
    }
  }
}
