import { Builder, By, Key } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome.js';
import { config } from '../config/config.js';

export class SeleniumUtils {
  static async createDriver(sessionId = null) {
    const options = new chrome.Options();
    const args = [
      ...config.chrome.defaultArgs,
      sessionId ? `--user-data-dir=/tmp/chrome-${sessionId}` : null
    ].filter(Boolean);
    
    options.addArguments(args);

    const driver = await new Builder()
      .forBrowser('chrome')
      .setChromeOptions(options)
      .build();

    return driver;
  }

  static async switchToActiveElement(driver) {
    let activeElement = await driver.switchTo().activeElement();
    let tagName = await activeElement.getTagName();

    while (tagName === 'iframe') {
      await driver.switchTo().frame(activeElement);
      activeElement = await driver.switchTo().activeElement();
      tagName = await activeElement.getTagName();
    }

    return activeElement;
  }

  static async tabUntilMatch(driver, textToMatch) {
    let found = false;
    let attempts = 0;
    const maxAttempts = 50;

    while (!found && attempts < maxAttempts) {
      await driver.actions().sendKeys(Key.TAB).perform();
      const element = await this.switchToActiveElement(driver);
      const text = await element.getText();
      
      if (text.includes(textToMatch)) {
        found = true;
        return element;
      }
      
      attempts++;
    }
    
    return null;
  }

  static async executeInstruction(driver, instruction, data = {}) {
    const { username, password } = data;
    
    switch (instruction) {
      case 'TAB':
        await driver.actions().sendKeys(Key.TAB).perform();
        break;
      case 'ENTER':
        await driver.actions().sendKeys(Key.RETURN).perform();
        break;
      case 'INPUTUSR':
        await driver.actions().sendKeys(username).perform();
        break;
      case 'INPUTPASS':
        await driver.actions().sendKeys(password).perform();
        break;
      default:
        if (instruction.startsWith('SLEEP')) {
          const time = parseInt(instruction.match(/\d+/)[0], 10);
          await driver.sleep(time);
        }
    }
  }
}
