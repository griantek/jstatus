import { SeleniumUtils } from '../../utils/selenium.js';
import { ScreenshotService } from '../../services/screenshot.js';
import { InstructionService } from '../../services/instruction.js';

class BaseJournalHandler {
  static async handle(driver, match, order, whatsappNumber) {
    try {
      await driver.get(match.url);
      await driver.sleep(5000);
      await InstructionService.executeInstructions(
        driver, 
        match.username, 
        match.password, 
        order, 
        match.url, 
        whatsappNumber
      );
    } catch (error) {
      console.error(`Error processing journal ${match.url}:`, error);
      await ScreenshotService.capture(driver, `error_${order}`, whatsappNumber);
      throw error;
    }
  }
}

export class EditorialManagerJournal extends BaseJournalHandler {
  static async checkStatus(driver, order, foundTexts, whatsappNumber) {
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

export class ManuscriptCentralJournal extends BaseJournalHandler {
  static async checkStatus(driver, order, foundTexts, whatsappNumber) {
    const statusElements = await driver.findElements({ css: '.manuscript-status' });
    for (const element of statusElements) {
      const text = await element.getText();
      if (text && !foundTexts.has(text)) {
        foundTexts.add(text);
        await ScreenshotService.capture(driver, `mc_${text}`, whatsappNumber);
      }
    }
  }
}

// Add other journal handlers with their specific status checking logic
export const JournalHandlers = {
  getHandler(url) {
    url = url.toLowerCase();
    if (url.includes('editorialmanager')) return EditorialManagerJournal;
    if (url.includes('manuscriptcentral')) return ManuscriptCentralJournal;
    // ... add other handlers ...
    throw new Error(`No handler found for URL: ${url}`);
  }
};
