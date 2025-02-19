import { Builder, By, Key, until } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome.js';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { seleniumConfig } from '../config/dbConfig.js';
import { performanceLogger, systemLogger } from '../utils/logger.js';
import { sendWhatsAppMessage, sendWhatsAppImage } from '../utils/logger.js';
import { screenshotManager } from './screenshotManager.js';

async function switchToActiveElement(driver) {
  let activeElement = await driver.switchTo().activeElement();
  let tagName = await activeElement.getTagName();

  // Check if the active element is an iframe
  while (tagName === 'iframe') {
    await driver.switchTo().frame(activeElement);
    activeElement = await driver.switchTo().activeElement();
    tagName = await activeElement.getTagName();
  }

  return activeElement;
}

export const SessionManager = {
  sessions: new Map(),

  createSession(userId) {
    const sessionId = uuidv4();
    const session = {
      id: sessionId,
      userId,
      createdAt: Date.now(),
      driver: null
    };
    this.sessions.set(sessionId, session);
    return sessionId;
  },

  getSession(sessionId) {
    return this.sessions.get(sessionId);
  },

  async cleanupSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (session?.driver) {
      await session.driver.quit();
    }
    this.sessions.delete(sessionId);
  }
};

const waitForElement = async (driver, locator, timeout = 10000) => {
  try {
    const element = await driver.wait(until.elementLocated(locator), timeout);
    await driver.wait(until.elementIsVisible(element), timeout);
    return element;
  } catch (error) {
    console.error(`Timeout waiting for element: ${locator}`);
    throw error;
  }
};

const handleJournalError = async (error, driver, whatsappNumber, userId) => {
  systemLogger.logSystemError('journal-automation', error);
  
  try {
    // Take error screenshot
    await screenshotManager.capture(driver, 'error_state', userId);
    
    // Send error notification
    await sendWhatsAppMessage(whatsappNumber, {
      messaging_product: "whatsapp",
      to: whatsappNumber,
      type: "text",
      text: { body: "An error occurred while processing your journal. Support has been notified." }
    });
  } catch (notificationError) {
    console.error('Error handling journal error:', notificationError);
  }
};

// Add these functions to the bottom of the file
export const retryOperation = async (operation, maxRetries = 3) => {
  let lastError;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      console.error(`Operation attempt ${attempt} failed:`, error);
      if (attempt === maxRetries) throw lastError;
      await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
    }
  }
};

const createDriverWithRetry = async (options, maxRetries = 3) => {
  let lastError;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const driver = await new Builder()
        .forBrowser("chrome")
        .setChromeOptions(options)
        .build();
      return driver;
    } catch (error) {
      lastError = error;
      console.error(`Driver creation attempt ${attempt} failed:`, error);
      await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
    }
  }
  
  throw new Error(`Failed to create driver after ${maxRetries} attempts: ${lastError}`);
};

// Replace existing createWebDriver with retry version
export const createWebDriver = async () => {
  const options = new chrome.Options();
  options.addArguments([
    "--headless",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--window-size=1920,1080",
    "--incognito"
  ]);

  return createDriverWithRetry(options);
};

// Add timeout wrapper for selenium operations
export const withTimeout = async (operation, timeoutMs = 30000) => {
  return Promise.race([
    operation,
    new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Operation timed out')), timeoutMs)
    )
  ]);
};

// Add browser navigation retry logic
const navigateWithRetry = async (driver, url, maxRetries = 3) => {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await withTimeout(driver.get(url), 30000);
      return;
    } catch (error) {
      console.error(`Navigation attempt ${attempt} failed:`, error);
      if (attempt === maxRetries) throw error;
      await driver.sleep(1000 * attempt);
    }
  }
};

// Add element interaction helper
const interactWithElement = async (driver, element, action) => {
  try {
    await withTimeout(action(element), 10000);
  } catch (error) {
    console.error('Element interaction failed:', error);
    throw error;
  }
};

export const executeInstruction = async (driver, instruction, context) => {
  const { username, password, foundTexts, whatsappNumber, userId } = context;

  switch (instruction) {
    case 'TAB':
      await driver.actions().sendKeys(Key.TAB).perform();
      break;
    case 'SPACE':
      await driver.actions().sendKeys(Key.SPACE).perform();
      break;
    case 'ENTER':
      await driver.actions().sendKeys(Key.RETURN).perform();
      break;
    case 'ESC':
      await driver.actions().sendKeys(Key.ESCAPE).perform();
      break;
    case 'HOME':
      await driver.actions().sendKeys(Key.HOME).perform();
      break;
    case 'END':
      await driver.actions().sendKeys(Key.END).perform();
      break;
    case 'PAGEUP':
      await driver.actions().sendKeys(Key.PAGE_UP).perform();
      break;
    case 'PAGEDOWN':
      await driver.actions().sendKeys(Key.PAGE_DOWN).perform();
      break;
    case 'ARROWUP':
      await driver.actions().sendKeys(Key.ARROW_UP).perform();
      break;
    case 'ARROWDOWN':
      await driver.actions().sendKeys(Key.ARROW_DOWN).perform();
      break;
    case 'ARROWLEFT':
      await driver.actions().sendKeys(Key.ARROW_LEFT).perform();
      break;
    case 'ARROWRIGHT':
      await driver.actions().sendKeys(Key.ARROW_RIGHT).perform();
      break;
    // ... other basic key actions ...
    case 'CHKSTS':
      const url = context.url.toLowerCase();
      if (url.includes("editorialmanager")) {
        await handleEditorialManagerCHKSTS(driver, context.order, foundTexts, whatsappNumber, userId);
      } else if (url.includes("manuscriptcentral")) {
        await handleManuscriptCentralCHKSTS(driver, context.order, foundTexts);
      } else if (url.includes("thescipub")) {
        await handleTheSciPubCHKSTS(driver, context.order, foundTexts, whatsappNumber, userId);
      } else if (url.includes("taylorfrancis")) {
        await handleTaylorFrancisCHKSTS(driver, context.order, foundTexts);
      } else if (url.includes("wiley.scienceconnect.io")) {
        await handleWileyCHKSTS(driver, context.order, foundTexts);
      } else if (url.includes("periodicos")) {
        await handlePeriodicosCHKSTS(driver, context.order, foundTexts);
      } else if (url.includes("tspsubmission")) {
        await handleTSPSubmissionCHKSTS(driver, context.order, foundTexts);
      } else if (url.includes("springernature")) {
        await handleSpringerNatureCHKSTS(driver, context.order, foundTexts);
      }
      break;
    case 'CHKREGQS':
      await handleSurveyPopup(driver);
      break;
    case 'INPUTUSR':
      await driver.actions().sendKeys(username).perform();
      break;
    case 'INPUTPASS':
      await driver.actions().sendKeys(password).perform();
      break;
    case 'SCRNSHT':
      await screenshotManager.capture(driver, username, userId);
      break;
    case 'FIND':
      await driver.actions()
        .keyDown(Key.CONTROL)
        .sendKeys('f')
        .keyUp(Key.CONTROL)
        .perform();
      break;
    case 'PASTE':
      await driver.actions()
        .keyDown(Key.CONTROL)
        .sendKeys('v')
        .keyUp(Key.CONTROL)
        .perform();
      break;
    default:
      if (instruction.startsWith('SLEEP')) {
        const time = parseInt(instruction.match(/\d+/)[0], 10);
        await driver.sleep(time);
      } else if (instruction.startsWith('INPUT-')) {
        const inputString = instruction.replace('INPUT-', '');
        await driver.actions().sendKeys(inputString).perform();
      }
      break;
  }
};

const handleSurveyPopup = async (driver) => {
  try {
    const body = await driver.findElement(By.tagName('body'));
    await body.click();
    await driver.sleep(1000);

    const targetText = "Self-report your data to improve equity in research";
    let found = false;
    const mainWindow = await driver.getWindowHandle();

    for (let i = 0; i < 2; i++) {
      await driver.actions().sendKeys(Key.TAB).perform();
      let activeElement = await switchToActiveElement(driver);
      let text = await activeElement.getText();

      if (i === 1 && text.includes(targetText)) {
        found = true;
        await driver.actions().sendKeys(Key.RETURN).perform();
        
        const handles = await driver.getAllWindowHandles();
        if (handles.length > 1) {
          await driver.switchTo().window(handles[handles.length - 1]);
          await driver.close();
        }

        await driver.switchTo().window(mainWindow);
        await body.click();
        await driver.sleep(1000);

        for (let i = 0; i < 4; i++) {
          await driver.actions().sendKeys(Key.TAB).perform();
        }
        await driver.actions().sendKeys(Key.RETURN).perform();
        await driver.sleep(5000);
        await driver.navigate().refresh();
        break;
      }
    }

    if (!found) {
      await driver.navigate().refresh();
      await driver.sleep(5000);
    }
  } catch (error) {
    console.error("Error during survey popup check:", error);
    const handles = await driver.getAllWindowHandles();
    if (handles.length > 0) {
      await driver.switchTo().window(handles[0]);
    }
  }
};

export const handleEditorialManagerCHKSTS = async (driver, order, foundTexts, whatsappNumber, userId) => {
  let found = false;
  let attempts = 0;
  const MAX_ATTEMPTS = 20;

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

  try {
    while (!found && attempts < MAX_ATTEMPTS) {
      attempts++;

      await driver.actions().sendKeys(Key.TAB).perform();

      let activeElement = await switchToActiveElement(driver);
      let text = await activeElement.getText();

      if (textCollection.includes(text) && !foundTexts.includes(text)) {
        found = true;
        foundTexts.push(text);

        try {
          await driver.actions()
            .keyDown(Key.CONTROL)
            .sendKeys(Key.RETURN)
            .keyUp(Key.CONTROL)
            .perform();

          const tabs = await driver.getAllWindowHandles();

          await driver.switchTo().window(tabs[1]);
          await driver.sleep(5000);

          await screenshotManager.capture(driver, text, userId);

          await driver.close();
          await driver.switchTo().window(tabs[0]);
          await driver.actions().sendKeys(Key.HOME).perform();
          await driver.sleep(2000);
          break;
        } catch (error) {
          console.error('Error handling tab operations:', error);
          const tabs = await driver.getAllWindowHandles();
          await driver.switchTo().window(tabs[0]);
        }
      }
    }

    if (!found) {
      return;
    }

    let notFoundInCollection = false;
    attempts = 0;

    while (!notFoundInCollection && attempts < MAX_ATTEMPTS) {
      attempts++;

      await driver.actions().sendKeys(Key.TAB).perform();
      await driver.sleep(1000);

      let activeElement = await switchToActiveElement(driver);
      let text = await activeElement.getText();

      if (!text) {
        continue;
      }

      if (!textCollection.includes(text)) {
        notFoundInCollection = true;
      } else if (!foundTexts.includes(text)) {
        foundTexts.push(text);

        try {
          await driver.actions()
            .keyDown(Key.CONTROL)
            .sendKeys(Key.RETURN)
            .keyUp(Key.CONTROL)
            .perform();

          const tabs = await driver.getAllWindowHandles();

          await driver.switchTo().window(tabs[1]);
          await driver.sleep(5000);

          await screenshotManager.capture(driver, text, userId);

          await driver.close();
          await driver.switchTo().window(tabs[0]);
          await driver.actions().sendKeys(Key.HOME).perform();
          await driver.sleep(2000);
        } catch (error) {
          console.error('Error handling additional status:', error);
        }
      }
    }

  } catch (error) {
    console.error('Error in handleEditorialManagerCHKSTS:', error);
  } finally {
    console.log("Editorial Manager status check completed");
  }
};

export const handleManuscriptCentralCHKSTS = async (driver, order, foundTexts) => {
  try {
    await driver.sleep(20000); // Add delay for element focus
    // Implementation for Manuscript Central status check
    const tabs = await driver.getAllWindowHandles();
    if (tabs.length > 1) {
      await driver.switchTo().window(tabs[1]);
      await driver.sleep(5000);
      await screenshotManager.capture(driver, "manuscript_central_status", order);
      await driver.close();
      await driver.switchTo().window(tabs[0]);
    }
  } catch (error) {
    console.error('ManuscriptCentral CHKSTS error:', error);
  }
};

export const handleTandFOnlineCHKSTS = async (driver, order, foundTexts) => {
  try {
    const body = await driver.findElement(By.tagName('body'));
    await body.click();
    await driver.sleep(2000);
    await screenshotManager.capture(driver, "tandf_online_status", order);
  } catch (error) {
    console.error('TandFOnline CHKSTS error:', error);
  }
};

export const handleTheSciPubCHKSTS = async (driver, order, foundTexts, whatsappNumber, userId) => {
  try {
    for (let i = 0; i < 13; i++) {
      await driver.actions().sendKeys(Key.TAB).perform();
      await driver.sleep(1000);
      let activeElement = await switchToActiveElement(driver);
      let text = await activeElement.getText();

      if (i >= 2 && text.includes("(1)")) {
        await driver.actions()
          .keyDown(Key.CONTROL)
          .sendKeys(Key.RETURN)
          .keyUp(Key.CONTROL)
          .perform();

        const tabs = await driver.getAllWindowHandles();
        await driver.switchTo().window(tabs[1]);
        await driver.sleep(5000);
        await screenshotManager.capture(driver, text, userId);
        await driver.close();
        await driver.switchTo().window(tabs[0]);
        await driver.actions().sendKeys(Key.HOME).perform();
        await driver.sleep(2000);
      }
    }
  } catch (error) {
    console.error('TheSciPub CHKSTS error:', error);
  }
};

export const handleCGScholarCHKSTS = async (driver, order, foundTexts) => {
  try {
    await driver.get("https://cgp.cgscholar.com/m/WithdrawalSubmission?init=true");
    await driver.sleep(5000);
    await screenshotManager.capture(driver, "cgscholar_status", order);
  } catch (error) {
    console.error('CGScholar CHKSTS error:', error);
  }
};

export const handleTaylorFrancisCHKSTS = async (driver, order, foundTexts) => {
  try {
    await driver.sleep(3000);
    await screenshotManager.capture(driver, "taylor_francis_status", order);
  } catch (error) {
    console.error('TaylorFrancis CHKSTS error:', error);
  }
};

export const handleWileyCHKSTS = async (driver, order, foundTexts) => {
  try {
    await driver.sleep(2000);
    const mainElement = await driver.findElement(By.css('main'));
    await screenshotManager.capture(driver, "wiley_status", order);
  } catch (error) {
    console.error('Wiley CHKSTS error:', error);
  }
};

export const handlePeriodicosCHKSTS = async (driver, order, foundTexts) => {
  try {
    await driver.sleep(3000);
    await screenshotManager.capture(driver, "periodicos_status", order);
  } catch (error) {
    console.error('Periodicos CHKSTS error:', error);
  }
};

export const handleTSPSubmissionCHKSTS = async (driver, order, foundTexts) => {
  try {
    await driver.sleep(3000);
    const statusElement = await driver.findElement(By.className('status-section'));
    await screenshotManager.capture(driver, "tsp_submission_status", order);
  } catch (error) {
    console.error('TSP Submission CHKSTS error:', error);
  }
};

export const handleSpringerNatureCHKSTS = async (driver, order, foundTexts) => {
  try {
    await driver.sleep(3000);
    await screenshotManager.capture(driver, "springer_nature_status", order);
  } catch (error) {
    console.error('Springer Nature CHKSTS error:', error);
  }
};

// Complete the executeInstructions function with remaining cases
export const executeInstructions = async (driver, username, password, order, journalLink, whatsappNumber, userId) => {
  try {
    const startTime = performance.now();

    const keysFile = determineKeysFile(journalLink);
    const instructions = fs.readFileSync(keysFile, "utf-8").split("\n");
    const foundTexts = [];

    for (const instruction of instructions) {
      const trimmedInstruction = instruction.trim();
      await executeInstruction(driver, trimmedInstruction, {
        username,
        password,
        foundTexts,
        whatsappNumber,
        userId,
        url: journalLink,
        order
      });
    }

    console.log(`Execution completed in ${((performance.now() - startTime) / 1000).toFixed(2)} seconds.`);
  } catch (error) {
    console.error("Error during instruction execution:", error);
    throw error;
  }
};

const determineKeysFile = (journalLink) => {
  const keyMappings = {
    'manuscriptcentral': 'keys/manus_KEYS.txt',
    'editorialmanager': 'keys/edito_KEYS.txt',
    'tandfonline': 'keys/tandf_KEYS.txt',
    'taylorfrancis': 'keys/taylo_KEYS.txt',
    'cgscholar': 'keys/cgsch_KEYS.txt',
    'thescipub': 'keys/thesc_KEYS.txt',
    'wiley.scienceconnect.io': 'keys/wiley_KEYS.txt',
    'periodicos': 'keys/perio_KEYS.txt',
    'tspsubmission': 'keys/tspsu_KEYS.txt',
    'springernature': 'keys/springer_KEYS.txt'
  };

  const matchingKey = Object.keys(keyMappings).find(key => journalLink.includes(key));
  if (!matchingKey) {
    throw new Error(`No keys file defined for URL: ${journalLink}`);
  }
  return keyMappings[matchingKey];
};

export const automateProcess = async (match, order, whatsappNumber, userId) => {
  const sessionId = SessionManager.createSession(whatsappNumber);
  const session = SessionManager.getSession(sessionId);

  const options = new chrome.Options();
  options.addArguments([
    "--headless",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--window-size=1920,1080",
    "--incognito"
  ]);

  try {
    const driver = await new Builder()
      .forBrowser("chrome")
      .setChromeOptions(options)
      .build();

    session.driver = driver;

    await Promise.race([navigateWithRetry(driver, match.url),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Navigation timeout')), 30000)
      )
    ]);

    await driver.sleep(5000);
    await executeInstructions(driver, match.username, match.password, order, match.url, whatsappNumber, userId);

  } catch (error) {
    console.error("Automation error:", error);
    await screenshotManager.sendToWhatsApp(whatsappNumber, userId);
  } finally {
    await SessionManager.cleanupSession(sessionId);
  }
};
