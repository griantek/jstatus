import { Builder, until } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome.js';
import { config } from '../config/config.js';

export class BrowserUtils {
  static async createSession(sessionId) {
    const options = new chrome.Options();
    const args = [
      ...config.chrome.defaultArgs,
      sessionId ? `--user-data-dir=/tmp/chrome-${sessionId}` : null
    ].filter(Boolean);
    
    options.addArguments(args);

    return new Builder()
      .forBrowser('chrome')
      .setChromeOptions(options)
      .build();
  }

  static async waitForElement(driver, locator, timeout = 10000) {
    return driver.wait(until.elementLocated(locator), timeout);
  }

  static async waitForElementVisible(driver, element, timeout = 10000) {
    return driver.wait(until.elementIsVisible(element), timeout);
  }

  static async cleanupSession(sessionId) {
    if (!sessionId) return;
    
    const userDataDir = `/tmp/chrome-${sessionId}`;
    try {
      if (fs.existsSync(userDataDir)) {
        fs.rmSync(userDataDir, { recursive: true, force: true });
      }
    } catch (error) {
      console.error(`Error cleaning up session ${sessionId}:`, error);
    }
  }
}
