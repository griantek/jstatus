import { Key } from 'selenium-webdriver';
import { SeleniumUtils } from '../../utils/selenium.js';
import { ScreenshotService } from '../../services/screenshot.js';
import { BrowserUtils } from '../../utils/browser.js';

export const journalHandlers = {
  async editorialManager(driver, order, foundTexts, whatsappNumber) {
    const textCollection = [
      "Submissions Sent Back to Author",
      "Incomplete Submissions",
      "Submissions Waiting for Author's Approval",
      "Submissions Being Processed",
      "Submissions Needing Revision",
      "Revisions Sent Back to Author",
      "Incomplete Submissions Being Revised",
      "Revisions Waiting for Author's Approval",
      "Revisions Being Processed",
      "Declined Revisions",
      "Submissions with a Decision",
      "Submissions with Production Completed",
      "Submission Transfers Waiting for Author's Approval"
    ];

    for (const text of textCollection) {
      const element = await SeleniumUtils.tabUntilMatch(driver, text);
      if (element && !foundTexts.includes(text)) {
        foundTexts.push(text);
        await this.captureStatus(driver, element, text, order, whatsappNumber);
      }
    }
  },

  async manuscriptCentral(driver, order, foundTexts) {
    await driver.sleep(5000);
    const elements = await driver.findElements({ css: '.manuscript-status, .status-cell' });
    
    for (const element of elements) {
      const text = await element.getText();
      if (text && !foundTexts.includes(text)) {
        foundTexts.push(text);
        await this.captureStatus(driver, element, text, order, whatsappNumber);
      }
    }
  },

  async tandfonline(driver, order, foundTexts) {
    await driver.sleep(3000);
    const statusElements = await driver.findElements({ css: '.submission-status' });
    
    for (const element of statusElements) {
      const text = await element.getText();
      if (text && !foundTexts.includes(text)) {
        foundTexts.push(text);
        await this.captureStatus(driver, element, text, order, whatsappNumber);
      }
    }
  },

  async cgscholar(driver, order, foundTexts) {
    await driver.get("https://cgp.cgscholar.com/m/WithdrawalSubmission?init=true");
    await driver.sleep(5000);
    await ScreenshotService.capture(driver, "CGScholar_Status", whatsappNumber);
  },

  async thescipub(driver, order, foundTexts, whatsappNumber) {
    for (let i = 0; i < 13; i++) {
      await driver.actions().sendKeys(Key.TAB).perform();
      await driver.sleep(1000);
      
      const element = await SeleniumUtils.switchToActiveElement(driver);
      const text = await element.getText();
      
      if (i >= 2 && text.includes("(1)")) {
        await this.captureStatus(driver, element, text, order, whatsappNumber);
      }
    }
  },

  async handleManuscriptCentralCHKSTS(driver, order, foundTexts) {
    // Copy from app copy.js ManuscriptCentral handler
  },
  
  async handleWileyCHKSTS(driver, order, foundTexts) {
    // Copy from app copy.js Wiley handler
  },
  
  async handlePeriodicosCHKSTS(driver, order, foundTexts) {
    // Copy from app copy.js Periodicos handler
  },

  // Helper method for capturing status
  async captureStatus(driver, element, text, order, whatsappNumber) {
    // Open in new tab
    await driver.actions().keyDown(Key.CONTROL).sendKeys(Key.RETURN).keyUp(Key.CONTROL).perform();
    const tabs = await driver.getAllWindowHandles();
    await driver.switchTo().window(tabs[1]);
    await driver.sleep(5000);

    // Take screenshot
    await ScreenshotService.capture(driver, `${order}_${text}`, whatsappNumber);

    // Close tab and switch back
    await driver.close();
    await driver.switchTo().window(tabs[0]);
    await driver.actions().sendKeys(Key.HOME).perform();
  },

  // Get appropriate handler
  getHandler(url) {
    url = url.toLowerCase();
    const handlers = {
      'editorialmanager': this.editorialManager,
      'manuscriptcentral': this.manuscriptCentral,
      'tandfonline': this.tandfonline,
      'cgscholar': this.cgscholar,
      'thescipub': this.thescipub
    };

    for (const [domain, handler] of Object.entries(handlers)) {
      if (url.includes(domain)) {
        return handler;
      }
    }

    throw new Error(`No handler found for URL: ${url}`);
  }
};
