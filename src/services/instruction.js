import fs from 'fs';
import path from 'path';
import { Key, By } from 'selenium-webdriver';
import { SeleniumUtils } from '../utils/selenium.js';
import { ScreenshotService } from './screenshot.js';
import { WhatsAppService } from './whatsapp.js';
import { performance } from 'perf_hooks';

export class InstructionService {
  static async executeInstructions(driver, username, password, order, journalLink, whatsappNumber) {
    const startTime = performance.now();
    try {
      const instructions = await this.loadInstructions(journalLink);
      const foundTexts = [];

      for (const instruction of instructions) {
        const trimmed = instruction.trim();
        
        if (trimmed === "CHKSTS") {
          await this.handleChkSts(driver, order, foundTexts, whatsappNumber, journalLink);
          continue;
        }

        await this.executeBasicInstruction(driver, trimmed, { username, password });
      }

      const totalTime = ((performance.now() - startTime) / 1000).toFixed(2);
      console.log(`Execution completed in ${totalTime} seconds.`);
    } catch (error) {
      console.error("Error during instruction execution:", error);
      throw error;
    }
  }

  static async executeBasicInstruction(driver, instruction, { username, password }) {
    switch (instruction) {
      case "TAB":
        await driver.actions().sendKeys(Key.TAB).perform();
        break;
      case "SPACE":
        await driver.actions().sendKeys(Key.SPACE).perform();
      case "ESC":
        await driver.actions().sendKeys(Key.ESCAPE).perform();
        break;
      case "ENTER":
        await driver.actions().sendKeys(Key.RETURN).perform();
        break;
      case "FIND":
        await driver.actions().keyDown(Key.CONTROL).sendKeys("f").keyUp(Key.CONTROL).perform();
        break;
      case "PASTE":
        await driver.actions().keyDown(Key.CONTROL).sendKeys("v").keyUp(Key.CONTROL).perform();
        break;
      case "INPUTUSR":
        await driver.actions().sendKeys(username).perform();
        break;
      case "INPUTPASS":
        await driver.actions().sendKeys(password).perform();
        break;
      default:
        if (instruction.startsWith("SLEEP")) {
          const time = parseInt(instruction.match(/\d+/)[0], 10);
          await driver.sleep(time);
        } else if (instruction.startsWith("INPUT-")) {
          const inputString = instruction.replace("INPUT-", "");
          await driver.actions().sendKeys(inputString).perform();
        } else if (instruction.startsWith("CLICK-")) {
          const target = instruction.split("-")[1];
          await this.handleClick(driver, target);
        }
    }
  }

  static async handleClick(driver, target) {
    let element;
    switch (target) {
      case "input":
        element = await driver.findElement(By.id("USERID"));
        break;
      case "loginButton":
        element = await driver.findElement(By.id("login-button-default"));
        break;
      default:
        throw new Error(`Unknown click target: ${target}`);
    }
    await element.click();
  }

  static async handleChkSts(driver, order, foundTexts, whatsappNumber, journalLink) {
    const domain = this.getDomain(journalLink);
    if (!domain) {
      throw new Error(`No handler for URL: ${journalLink}`);
    }

    const handler = await import(`../handlers/journals/${domain}.js`);
    await handler.default.checkStatus(driver, order, foundTexts, whatsappNumber);
  }

  static async loadInstructions(journalLink) {
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

    const domain = Object.keys(keysMap).find(key => journalLink.includes(key));
    if (!domain) {
      throw new Error(`No keys file defined for URL: ${journalLink}`);
    }

    const keysFile = path.join('keys', keysMap[domain]);
    return fs.readFileSync(keysFile, 'utf-8').split('\n');
  }

  static getDomain(url) {
    const domainMap = {
      'manuscriptcentral': 'manuscriptCentral',
      'editorialmanager': 'editorialManager',
      'tandfonline': 'tandfonline',
      // ... other mappings
    };

    return Object.entries(domainMap)
      .find(([key]) => url.includes(key))?.[1];
  }
}
