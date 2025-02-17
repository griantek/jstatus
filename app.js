import express from "express";
import { Builder, By, Key, until } from "selenium-webdriver";
import chrome from "selenium-webdriver/chrome.js";
import fs from "fs";
import sqlite3 from "sqlite3";
import { performance } from "perf_hooks"; // Import performance from perf_hooks
import crypto from "crypto"; // Import crypto module
import axios from "axios"; // Added for WhatsApp API
import FormData from "form-data"; // Added for WhatsApp media uploads
import dotenv from "dotenv"; // Added for environment variables
import path from "path"; // Added for path handling
import { promisify } from 'util'; // Added for promisify
import { v4 as uuidv4 } from 'uuid';
import PQueue from 'p-queue';

dotenv.config();

// Add environment variable logging
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

const app = express();
const port = process.env.PORT || 8004;

app.use(express.json());

const algorithm = process.env.ENCRYPTION_ALGORITHM;
const key = Buffer.from(process.env.ENCRYPTION_KEY, 'hex');
const iv = Buffer.from(process.env.ENCRYPTION_IV, 'hex');

function decrypt(text) {
  try {
    if (!text) return '';
    
    
    // Convert hex string to bytes
    const encryptedBytes = Buffer.from(text, 'hex');
    
    // Create decipher with auto padding disabled
    const decipher = crypto.createDecipheriv(algorithm, key, iv);
    decipher.setAutoPadding(false);
    
    // Decrypt
    let decrypted;
    try {
      decrypted = decipher.update(encryptedBytes);
      decrypted = Buffer.concat([decrypted, decipher.final()]);
      
      // Remove space padding manually (similar to Python implementation)
      while (decrypted.length > 0 && decrypted[decrypted.length - 1] === 32) { // 32 is ASCII for space
        decrypted = decrypted.slice(0, -1);
      }
      
      const result = decrypted.toString('utf8');
      return result;
    } catch (cryptoError) {
      const decipherAuto = crypto.createDecipheriv(algorithm, key, iv);
      let decryptedAuto = decipherAuto.update(encryptedBytes);
      decryptedAuto = Buffer.concat([decryptedAuto, decipherAuto.final()]);
      const resultAuto = decryptedAuto.toString('utf8').trim();
      return resultAuto;
    }
  } catch (error) {
    console.error('Final decryption error:', error);
    return text;
  }
}

// Initialize SQLite database
const db = new sqlite3.Database(process.env.DB_PATH);

// Function to switch to the active element, handling nested iframes
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

// Add request queue to manage concurrent requests
const requestQueue = new PQueue({concurrency: 1});

// Add user session tracking
const userSessions = new Map();

// Modify screenshotManager to handle user-specific directories
const screenshotManager = {
  baseFolder: process.env.SCREENSHOT_FOLDER,
  sessions: new Map(),

  async init() {
    if (!fs.existsSync(this.baseFolder)) {
      fs.mkdirSync(this.baseFolder, { recursive: true });
    }
  },

  getUserFolder(userId) {
    if (!userId) {
      throw new Error("User ID is required to get user folder");
    }
    const userFolder = path.join(this.baseFolder, userId.replace(/[^a-zA-Z0-9]/g, '_'));
    if (!fs.existsSync(userFolder)) {
      fs.mkdirSync(userFolder, { recursive: true });
    }
    return userFolder;
  },

  createSession(userId) {
    if (!userId) {
      throw new Error("User ID is required to create session");
    }
    const sessionId = uuidv4();
    const sessionFolder = path.join(this.getUserFolder(userId), sessionId);
    
    if (!fs.existsSync(sessionFolder)) {
      fs.mkdirSync(sessionFolder, { recursive: true });
    }

    const session = {
      id: sessionId,
      userId,
      folder: sessionFolder,
      screenshots: new Set(),
      createdAt: Date.now(),
      lastAccessed: Date.now()
    };

    this.sessions.set(userId, session);
    return session;
  },

  async capture(driver, description, userId) {
    if (!userId) {
      throw new Error("User ID is required to capture screenshot");
    }

    try {
      const session = this.sessions.get(userId) || this.createSession(userId);
      session.lastAccessed = Date.now();

      const timestamp = new Date().toISOString().replace(/[-:.]/g, "");
      const safeDescription = description.replace(/[^a-zA-Z0-9]/g, '_');
      const filename = `${safeDescription}_${timestamp}.png`;
      const filepath = path.join(session.folder, filename);

      const image = await driver.takeScreenshot();
      await fs.promises.writeFile(filepath, image, 'base64');
      
      session.screenshots.add(filepath);
      console.log(`Screenshot saved: ${filepath}`);
      return filepath;
    } catch (error) {
      console.error('Screenshot capture error:', error);
      throw error;
    }
  },

  async sendToWhatsApp(whatsappNumber, userId) {
    if (!userId) {
      throw new Error("User ID is required to send screenshots to WhatsApp");
    }

    const session = this.sessions.get(userId);
    if (!session) {
      console.log(`No session found for user ${userId}`);
      return;
    }

    const screenshots = Array.from(session.screenshots);
    console.log(`Found ${screenshots.length} screenshots for user ${userId}`);
    
    if (screenshots.length === 0) {
      await sendWhatsAppMessage(whatsappNumber, {
        messaging_product: "whatsapp",
        to: whatsappNumber,
        type: "text",
        text: { body: "No new screenshots available." }
      });
      return;
    }

    try {
      // Verify all files exist before starting
      const existingFiles = screenshots.filter(file => {
        const exists = fs.existsSync(file);
        if (!exists) {
          console.log(`File not found: ${file}`);
        }
        return exists;
      });

      // Sort screenshots by creation time
      existingFiles.sort((a, b) => {
        try {
          const aStats = fs.statSync(a);
          const bStats = fs.statSync(b);
          return aStats.birthtimeMs - bStats.birthtimeMs;
        } catch (error) {
          console.error(`Error comparing files ${a} and ${b}:`, error);
          return 0;
        }
      });

      console.log(`Sending ${existingFiles.length} screenshots...`);

      // Send all screenshots
      for (const screenshotPath of existingFiles) {
        try {
          const caption = `Status update: ${path.basename(screenshotPath, '.png')}`;
          await sendWhatsAppImage(whatsappNumber, screenshotPath, caption);
          console.log(`Successfully sent: ${screenshotPath}`);
        } catch (error) {
          console.error(`Error sending screenshot ${screenshotPath}:`, error);
        }
      }

      // Wait 5 seconds before cleanup
      await new Promise(resolve => setTimeout(resolve, 5000));
      console.log('Cleanup delay completed, proceeding with cleanup...');
      
    } catch (error) {
      console.error('Error in sendToWhatsApp:', error);
      throw error;
    } finally {
      // Clean up in finally block to ensure it happens
      try {
        this.clearSession(userId);
      } catch (cleanupError) {
        console.error('Error during cleanup:', cleanupError);
      }
    }
  },

  clearSession(userId) {
    if (!userId) {
      throw new Error("User ID is required to clear session");
    }
    const session = this.sessions.get(userId);
    if (!session) return;

    try {
      // Only clear screenshots for this specific user's session
      for (const filepath of session.screenshots) {
        try {
          if (fs.existsSync(filepath)) {
            fs.unlinkSync(filepath);
          }
        } catch (error) {
          console.error(`Error deleting ${filepath}:`, error);
        }
      }

      // Only remove this user's session folder
      if (fs.existsSync(session.folder)) {
        fs.rmSync(session.folder, { recursive: true });
      }

      this.sessions.delete(userId);
      console.log(`Cleaned up session for user: ${userId}`);
    } catch (error) {
      console.error(`Error cleaning up session for user ${userId}:`, error);
    }
  },

  // Remove the clear() method as it's no longer needed

  // Modify clearAllScreenshots to be safer
  clearAllScreenshots() {
    // Only clean up sessions that are older than 30 minutes
    const MAX_SESSION_AGE = 30 * 60 * 1000; // 30 minutes
    const now = Date.now();

    for (const [userId, session] of this.sessions.entries()) {
      if (now - session.lastAccessed > MAX_SESSION_AGE) {
        this.clearSession(userId);
      }
    }
  }
};

// Add a session manager to track user sessions
const SessionManager = {
  sessions: new Map(),
  
  createSession(userId) {
    const sessionId = `${userId}_${Date.now()}`;
    const sessionFolder = path.join(process.env.SCREENSHOT_FOLDER, sessionId);
    
    if (!fs.existsSync(sessionFolder)) {
      fs.mkdirSync(sessionFolder, { recursive: true });
    }
    
    this.sessions.set(sessionId, {
      userId,
      folder: sessionFolder,
      screenshots: new Set(),
      createdAt: new Date(),
      driver: null
    });
    
    return sessionId;
  },
  
  async cleanupSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (session) {
      if (session.driver) {
        await session.driver.quit();
      }
      // Delete session folder
      if (fs.existsSync(session.folder)) {
        fs.rmSync(session.folder, { recursive: true });
      }
      this.sessions.delete(sessionId);
    }
  },
  
  getSession(sessionId) {
    return this.sessions.get(sessionId);
  }
};

// Initialize screenshot manager when app starts
screenshotManager.init();

// Function to parse and execute instructions from KEYS.txt
async function executeInstructions(driver, username, password, order, journalLink, whatsappNumber, userId) {
  try {
    // Start the timer
    const startTime = performance.now();
    console.log("Execution started...");

    // Determine the keys file based on the journal link
    let keysFile;
    if (journalLink.includes("manuscriptcentral")) {
      keysFile = "keys/manus_KEYS.txt";
    } else if (journalLink.includes("editorialmanager")) {
      keysFile = "keys/edito_KEYS.txt";
    } else if (journalLink.includes("tandfonline")) {
      keysFile = "keys/tandf_KEYS.txt";
    } else if (journalLink.includes("taylorfrancis")) {
      keysFile = "keys/taylo_KEYS.txt";
    } else if (journalLink.includes("cgscholar")) {
      keysFile = "keys/cgsch_KEYS.txt";
    } else if (journalLink.includes("thescipub")) {
      keysFile = "keys/thesc_KEYS.txt";
    } else if (journalLink.includes("wiley.scienceconnect.io")) {
      keysFile = "keys/wiley_KEYS.txt";
    } else if (journalLink.includes("periodicos")) {
      keysFile = "keys/perio_KEYS.txt";
    } else if (journalLink.includes("tspsubmission")) {
      keysFile = "keys/tspsu_KEYS.txt";
    } else if (journalLink.includes("springernature")) {
      keysFile = "keys/springer_KEYS.txt";
    } else {
      throw new Error(`No keys file defined for URL: ${journalLink}`);
    }

    const instructions = fs.readFileSync(keysFile, "utf-8").split("\n");
    const foundTexts = [];

    for (const [index, instruction] of instructions.entries()) {
      const trimmedInstruction = instruction.trim();
      const elapsedTime = ((performance.now() - startTime) / 1000).toFixed(2);

      // console.log(
      //   `Time Elapsed: ${elapsedTime} seconds | Executing instruction [${
      //     index + 1
      //   }]: ${trimmedInstruction}`
      // );

      // console.log(`${trimmedInstruction}`);

      if (trimmedInstruction === "TAB") {
        await driver.actions().sendKeys(Key.TAB).perform();
        // let activeElement = await switchToActiveElement(driver);
        // let text = await activeElement.getText();
        // console.log(`Current highlighted text: ${text}`);
        // await driver.sleep(5000);
      } else if (trimmedInstruction === "SPACE") {
        await driver.actions().sendKeys(Key.SPACE).perform();
      } else if (trimmedInstruction === "ESC") {
        await driver.actions().sendKeys(Key.ESCAPE).perform();
      } else if (trimmedInstruction === "ENTER") {
        await driver.actions().sendKeys(Key.RETURN).perform();
      } else if (trimmedInstruction === "FIND") {
        await driver.actions().keyDown(Key.CONTROL).perform(); // Press CTRL
        await driver.actions().sendKeys("f").perform();       // Press F
        await driver.actions().keyUp(Key.CONTROL).perform();   // Release CTRL
      } else if (trimmedInstruction === "PASTE") {
        await driver
          .actions()
          .keyDown(Key.CONTROL)
          .sendKeys("v")
          .keyUp(Key.CONTROL)
          .perform();
      } else if (trimmedInstruction.startsWith("SLEEP")) {
        const time = parseInt(trimmedInstruction.match(/\d+/)[0], 10);
        await driver.sleep(time);
      } else if (trimmedInstruction === "INPUTUSR") {
        await driver.actions().sendKeys(username).perform();
      } else if (trimmedInstruction === "INPUTPASS") {
        await driver.actions().sendKeys(password).perform();
      } else if (trimmedInstruction === "SCRNSHT") {
        console.log("Taking screenshot of current page...");
        await screenshotManager.capture(driver, username, userId);
        // Remove the immediate deletion
        // await sendWhatsAppImage(whatsappNumber, screenshotPath, ``);
        // fs.unlinkSync(screenshotPath);
      } else if (trimmedInstruction.startsWith("INPUT-")) {
        const inputString = trimmedInstruction.replace("INPUT-", "");
        await driver.actions().sendKeys(inputString).perform();
        console.log(`Typed input: ${inputString}`);
      } else if (trimmedInstruction.startsWith("CLICK")) {
        const clickTarget = trimmedInstruction.split("-")[1];
        let inputElement;
        if (clickTarget === "input") {
          inputElement = await driver.findElement(By.id("USERID"));
        } else if (clickTarget === "loginButton") {
          inputElement = await driver.findElement(By.id("login-button-default"));
        } else {
          console.log(`Unknown CLICK target: ${clickTarget}`);
          continue;
        }
        await inputElement.click();
        console.log(`Clicked on element with target: ${clickTarget}`);
      } else if (trimmedInstruction === "CHKSTS") {
        if (journalLink.includes("editorialmanager")) {
          await handleEditorialManagerCHKSTS(driver, order, foundTexts, whatsappNumber, userId);
        } else if (journalLink.includes("manuscriptcentral")) {
          await handleManuscriptCentralCHKSTS(driver, order, foundTexts);
          await driver.sleep(20000); // Add a delay to ensure the element is focused
        } else if (journalLink.includes("tandfonline")) {
          await handleTandFOnlineCHKSTS(driver, order, foundTexts);
        } else if (journalLink.includes("taylorfrancis")) {
          await handleTaylorFrancisCHKSTS(driver, order, foundTexts);
        } else if (journalLink.includes("cgscholar")) {
          await handleCGScholarCHKSTS(driver, order, foundTexts);
        } else if (journalLink.includes("thescipub")) {
          await handleTheSciPubCHKSTS(driver, order, foundTexts, whatsappNumber);
        } else if (journalLink.includes("wiley.com")) {
          await handleWileyCHKSTS(driver, order, foundTexts);
        } else if (journalLink.includes("periodicos")) {
          await handlePeriodicosCHKSTS(driver, order, foundTexts);
        } else if (journalLink.includes("tspsubmission")) {
          await handleTSPSubmissionCHKSTS(driver, order, foundTexts);
        } else if (journalLink.includes("springernature")) {
          await handleSpringerNatureCHKSTS(driver, order, foundTexts);
        } else {
          console.log(`No CHKSTS handler for URL: ${journalLink}`);
        }
      } else {
        console.log(`Unknown instruction: ${trimmedInstruction}`);
        await driver.sleep(200000); // Add a delay to ensure the element is focused
      }
    }

    const totalTime = ((performance.now() - startTime) / 1000).toFixed(2);
    console.log(`Execution completed in ${totalTime} seconds.`);
  } catch (error) {
    console.error("Error during instruction execution:", error);
  }
}

// Define CHKSTS handlers for each journal type
async function handleEditorialManagerCHKSTS(driver, order, foundTexts, whatsappNumber, userId) {
  let found = false;
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

  while (!found) {
    await driver.actions().sendKeys(Key.TAB).perform();
    // await driver.sleep(1000);
    let activeElement = await switchToActiveElement(driver);
    let text = await activeElement.getText();

    if (textCollection.includes(text) && !foundTexts.includes(text)) {
      console.log(`Found this guy'${text}'.`);
      found = true;
      foundTexts.push(text);

      // Open in new tab
      await driver.actions().keyDown(Key.CONTROL).sendKeys(Key.RETURN).keyUp(Key.CONTROL).perform();
      const tabs = await driver.getAllWindowHandles();
      await driver.switchTo().window(tabs[1]);
      await driver.sleep(10000);

      // Take screenshot and save (don't send yet)
      console.log("Taking screenshot of the current page...");
      await screenshotManager.capture(driver, text, userId);

      // Close tab & switch back
      await driver.close();
      await driver.switchTo().window(tabs[0]);
      await driver.actions().sendKeys(Key.HOME).perform();
      await driver.sleep(2000);
      break;
    }
  }

  let notFoundInCollection = false;
  while (!notFoundInCollection) {
    await driver.actions().sendKeys(Key.TAB).perform();
    await driver.sleep(2000);
    let activeElement = await switchToActiveElement(driver);
    let text = await activeElement.getText();

    if (text && !textCollection.includes(text)) {
      console.log(`Found something not in collection: '${text}'`);
      notFoundInCollection = true;
    } else if (textCollection.includes(text) && !foundTexts.includes(text)) {
      console.log(`Found this guy again: '${text}'`);
      foundTexts.push(text);

      // Open in new tab
      await driver.actions().keyDown(Key.CONTROL).sendKeys(Key.RETURN).keyUp(Key.CONTROL).perform();
      const tabs = await driver.getAllWindowHandles();
      await driver.switchTo().window(tabs[1]);
      await driver.sleep(10000);

      // Take screenshot and save (don't send yet)
      console.log("Taking screenshot of the current page...");
      await screenshotManager.capture(driver, text, userId);

      // Close tab & switch back
      await driver.close();
      await driver.switchTo().window(tabs[0]);
      await driver.actions().sendKeys(Key.HOME).perform();
      await driver.sleep(2000);
    }
  }
}

/////////////// WHATSAPP MSG FUNCTIONS //////////////////////
async function sendWhatsAppMessage(to, message) {
  try {
    await axios.post(
      `https://graph.facebook.com/v21.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
      message,
      {
        headers: {
          'Authorization': `Bearer ${process.env.WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );  
  } catch (error) {
    console.error('Error sending WhatsApp message:', error.response?.data || error.message);
    throw error;
  }
}

async function uploadWhatsAppMedia(imagePath) {
  try {
    const formData = new FormData();
    formData.append('file', fs.createReadStream(imagePath));
    formData.append('messaging_product', 'whatsapp');

    console.log("Uploading media to WhatsApp...");
    const response = await axios.post(
      `https://graph.facebook.com/v21.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/media`,
      formData,
      {
        headers: {
          ...formData.getHeaders(),
          'Authorization': `Bearer ${process.env.WHATSAPP_TOKEN}`
        }
      }
    );

    console.log("Media uploaded successfully:", response.data);
    return response.data.id;
  } catch (error) {
    console.error('Error uploading WhatsApp media:', error.response?.data || error.message);
    throw error;
  }
}

async function sendWhatsAppImage(to, imagePath, caption) {
  try {
    const mediaId = await uploadWhatsAppMedia(imagePath);

    const message = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: to,
      type: "image",
      image: {
        id: mediaId,
        caption: caption
      }
    };

    await sendWhatsAppMessage(to, message);
  } catch (error) {
    console.error('Error sending WhatsApp image:', error);
    throw error;
  }
}

// Add this new function to track new screenshots
const newlyGeneratedScreenshots = new Set();

// Modify the screenshot saving logic in executeInstructions and CHKSTS handlers
async function saveScreenshot(driver, folderPath, fileName, order) {
  if (!fs.existsSync(folderPath)) {
    fs.mkdirSync(folderPath, { recursive: true });
  }
  const screenshotPath = path.join(folderPath, fileName);
  const image = await driver.takeScreenshot();
  fs.writeFileSync(screenshotPath, image, "base64");
  newlyGeneratedScreenshots.add(screenshotPath);
  console.log(`Screenshot saved: ${screenshotPath}`);
}

// Replace the existing handleScreenshotRequest function
async function handleScreenshotRequest(username, whatsappNumber) {
  // Generate a unique request ID
  const requestId = uuidv4();
  
  return requestQueue.add(async () => {
    try {
      console.log(`Processing request ${requestId} for user ${username}`);
      
      // Create or get user session
      let session = userSessions.get(username);
      if (!session) {
        session = {
          id: uuidv4(),
          createdAt: Date.now(),
          lastAccessed: Date.now()
        };
        userSessions.set(username, session);
      }
      
      // Update last accessed time
      session.lastAccessed = Date.now();

      // Rest of the handleScreenshotRequest implementation...
      screenshotManager.clearSession(username);

      console.log("Searching for:", username);

      const rows = await new Promise((resolve, reject) => {
        // First try to find by Personal_Email
        db.all(
          "SELECT Journal_Link as url, Username as username, Password as password FROM journal_data WHERE Personal_Email = ?",
          [username],
          (err, emailRows) => {
            if (err) {
              reject(err);
              return;
            }

            if (emailRows && emailRows.length > 0) {
              console.log("Found by Personal_Email");
              resolve(emailRows);
              return;
            }

            // If no results by Personal_Email, try Client_Name
            db.all(
              "SELECT Journal_Link as url, Username as username, Password as password FROM journal_data WHERE Client_Name = ?",
              [username],
              (err, clientRows) => {
                if (err) {
                  reject(err);
                } else {
                  console.log("Found by Client_Name");
                  resolve(clientRows);
                }
              }
            );
          }
        );
      });

      if (!rows || rows.length === 0) {
        await sendWhatsAppMessage(whatsappNumber, {
          messaging_product: "whatsapp",
          to: whatsappNumber,
          type: "text",
          text: { body: "No account information found for the provided identifier. Please verify your Client Name or Email address and try again." }
        });
        return;
      }
      console.log("Found account information:", rows);

      // Clear the set of new screenshots before processing
      newlyGeneratedScreenshots.clear();

      // Process automation and generate new screenshots
      let matches = rows.map(row => {

        // Try decryption with detailed logging
        let decrypted = {};
        try {
          decrypted.url = row.url ? decrypt(row.url) : '';
          console.log('Decrypted URL:', decrypted.url);
        } catch (e) {
          console.error('URL decryption error:', e);
          decrypted.url = '';
        }

        try {
          decrypted.username = row.username ? decrypt(row.username) : '';
          // console.log('Decrypted username:', decrypted.username); 
        } catch (e) {
          console.error('Username decryption error:', e);
          decrypted.username = '';
        }

        try {
          decrypted.password = row.password ? decrypt(row.password) : '';
          // console.log('Decrypted password:', decrypted.password);
        } catch (e) {
          console.error('Password decryption error:', e);
          decrypted.password = '';
        }

        return decrypted;
      }).filter(match => {
        const isValid = match.url && match.username && match.password;
        return isValid;
      });

      if (matches.length === 0) {
        await sendWhatsAppMessage(whatsappNumber, {
          messaging_product: "whatsapp",
          to: whatsappNumber,
          type: "text",
          text: { body: "We found your account, but there appear to be missing or incomplete journal credentials. Please contact support for assistance." }
        });
        return;
      }

      // Process each match (this will generate new screenshots)
      for (const [index, match] of matches.entries()) {
        await handleJournal(match, index + 1, whatsappNumber, username);
      }

      // Send all captured screenshots at once
      await screenshotManager.sendToWhatsApp(whatsappNumber, username);

      // Clear the screenshots set after processing
      newlyGeneratedScreenshots.clear();

      // Send completion message
      await sendWhatsAppMessage(whatsappNumber, {
        messaging_product: "whatsapp",
        to: whatsappNumber,
        type: "text",
        text: { body: "All new status updates have been sent." }
      });

    } catch (error) {
      console.error(`Error processing request ${requestId}:`, error);
      throw error;
    } finally {
      // Cleanup
      screenshotManager.clearSession(username);
      console.log(`Completed request ${requestId}`);
    }
  });
}

// Add WhatsApp webhook routes
app.get('/webhook', (req, res) => {
  console.log('WhatsApp webhook verification request received.');
  if (req.query['hub.verify_token'] === process.env.VERIFY_TOKEN) {
    res.status(200).send(req.query['hub.challenge']);
  } else {
    res.sendStatus(403);
  }
});

app.post('/webhook', async (req, res) => {
  try {
    const messageData = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!messageData) return res.sendStatus(400);

    const from = messageData.from;
    const messageId = messageData.id;

    // Check if the message has already been processed
    if (processedMessages.has(messageId)) {
      console.log(`Message ${messageId} already processed.`);
      return res.sendStatus(200);
    }

    // Mark the message as processed
    processedMessages.add(messageId);

    if (messageData.type === 'text') {
      console.log(`Received text message from ${from}: ${messageData.text.body}`);
      const username = messageData.text.body.trim();
      await handleScreenshotRequest(username, from);
    }

    res.sendStatus(200);
  } catch (error) {
    console.error('Webhook error:', error);
    res.sendStatus(500);
  }
});

// Store processed message IDs to avoid duplicate processing
const processedMessages = new Set();

// Define other CHKSTS handlers (currently empty)
async function handleManuscriptCentralCHKSTS(driver, order, foundTexts) {
  // Add code for Manuscript Central CHKSTS handling
}

async function handleTandFOnlineCHKSTS(driver, order, foundTexts) {
  // Add code for TandF Online CHKSTS handling
}

async function handleTaylorFrancisCHKSTS(driver, order, foundTexts) {
  // Add code for Taylor Francis CHKSTS handling
}

async function handleCGScholarCHKSTS(driver, order, foundTexts) {
  // Add code to navigate to the URL
  await driver.get("https://cgp.cgscholar.com/m/WithdrawalSubmission?init=true");
  await driver.sleep(5000); // Wait for 5 seconds

  // Take screenshot
  // console.log("Taking screenshot of the current page...");
  // const screenshotFolder = `screenshot/${order}`;
  // if (!fs.existsSync(screenshotFolder)) {
  //   fs.mkdirSync(screenshotFolder, { recursive: true });
  // }
  // const timestamp = new Date().toISOString().replace(/[-:.]/g, "");
  // const screenshotName = `${screenshotFolder}/WithdrawalSubmission_${timestamp}.png`;
  // const image = await driver.takeScreenshot();
  // fs.writeFileSync(screenshotName, image, "base64");
}

async function handleTheSciPubCHKSTS(driver, order, foundTexts, whatsappNumber) {
  for (let i = 0; i < 13; i++) {
    await driver.actions().sendKeys(Key.TAB).perform();
    await driver.sleep(1000); // Add a delay to ensure the element is focused
    let activeElement = await switchToActiveElement(driver);

    let text = await activeElement.getText();
    console.log(`Current highlighted text: ${text}`);

    if (i >= 2 && text.includes("(1)")) {
      console.log(`Found text with (1): '${text}'`);

      // Open in a new tab
      await driver.actions().keyDown(Key.CONTROL).sendKeys(Key.RETURN).keyUp(Key.CONTROL).perform();

      // Switch to the new tab
      const tabs = await driver.getAllWindowHandles();
      await driver.switchTo().window(tabs[1]);

      // Wait for a specific element to be present on the new page
      await driver.sleep(5000);

      // Take screenshot
      console.log("Taking screenshot of the current page...");
      const screenshotFolder = `screenshot/${order}`;
      if (!fs.existsSync(screenshotFolder)) {
        fs.mkdirSync(screenshotFolder, { recursive: true });
      }
      const timestamp = new Date().toISOString().replace(/[-:.]/g, "");
      const screenshotName = `${screenshotFolder}/${text.replace(/[^a-zA-Z0-9]/g, '_')}_${timestamp}.png`;
      const image = await driver.takeScreenshot();
      fs.writeFileSync(screenshotName, "base64");

      // Send screenshot and delete it
      await sendWhatsAppImage(whatsappNumber, screenshotName, text);
      fs.unlinkSync(screenshotName);

      // Close the new tab and switch back to the original tab
      await driver.close();
      await driver.switchTo().window(tabs[0]);

      // Reset focus to a known element on the initial page
      await driver.actions().sendKeys(Key.HOME).perform();
      await driver.sleep(2000); // Add a delay to ensure the focus is reset
    }
  }
}

async function handleWileyCHKSTS(driver, order, foundTexts) {
  // Add code for Wiley CHKSTS handling
}

async function handlePeriodicosCHKSTS(driver, order, foundTexts) {
  // Add code for Periodicos CHKSTS handling
}

async function handleTSPSubmissionCHKSTS(driver, order, foundTexts) {
  // Add code for TSP Submission CHKSTS handling
}

async function handleSpringerNatureCHKSTS(driver, order, foundTexts) {
  // Add code for Springer Nature CHKSTS handling
}

// Function to handle different journal types
const handleJournal = async (match, order, whatsappNumber, userId) => {
  const url = match.url.toLowerCase();
  if (url.includes("manuscriptcentral")) {
    await handleManuscriptCentral(match, order, whatsappNumber, userId);
  } else if (url.includes("editorialmanager")) {
    await handleEditorialManager(match, order, whatsappNumber, userId);
  } else if (url.includes("tandfonline")) {
    await handleTandFOnline(match, order, whatsappNumber, userId);
  } else if (url.includes("taylorfrancis")) {
    await handleTaylorFrancis(match, order, whatsappNumber, userId);
  } else if (url.includes("cgscholar")) {
    await handleCGScholar(match, order, whatsappNumber, userId);
  } else if (url.includes("thescipub")) {
    await handleTheSciPub(match, order, whatsappNumber, userId);
  } else if (url.includes("wiley.com")) {
    await handleWiley(match, order, whatsappNumber, userId);
  } else if (url.includes("periodicos")) {
    await handlePeriodicos(match, order, whatsappNumber, userId);
  } else if (url.includes("tspsubmission")) {
    await handleTSPSubmission(match, order, whatsappNumber, userId);
  } else if (url.includes("springernature")) {
    await handleSpringerNature(match, order, whatsappNumber, userId);
  } else {
    console.log(`No handler for URL: ${match.url}`);
  }
};

// Define functions for each journal type
const handleManuscriptCentral = async (match, order, whatsappNumber, userId) => {
  console.log(`Handling Manuscript Central: ${match.url}`);
  await automateProcess(match, order, whatsappNumber, userId);
};

const handleEditorialManager = async (match, order, whatsappNumber, userId) => {
  console.log(`Handling Editorial Manager: ${match.url}`);
  await automateProcess(match, order, whatsappNumber, userId);
};

const handleTandFOnline = async (match, order, whatsappNumber, userId) => {
  console.log(`Handling TandF Online: ${match.url}`);
  await automateProcess(match, order, whatsappNumber, userId);
};

const handleTaylorFrancis = async (match, order, whatsappNumber, userId) => {
  console.log(`Handling Taylor Francis: ${match.url}`);
  await automateProcess(match, order, whatsappNumber, userId);
};

const handleCGScholar = async (match, order, whatsappNumber, userId) => {
  console.log(`Handling CG Scholar: ${match.url}`);
  await automateProcess(match, order, whatsappNumber, userId);
};

const handleTheSciPub = async (match, order, whatsappNumber, userId) => {
  console.log(`Handling The SciPub: ${match.url}`);
  await automateProcess(match, order, whatsappNumber, userId);
};

const handleWiley = async (match, order, whatsappNumber, userId) => {
  console.log(`Handling Wiley: ${match.url}`);
  await automateProcess(match, order, whatsappNumber, userId);
};

const handlePeriodicos = async (match, order, whatsappNumber, userId) => {
  console.log(`Handling Periodicos: ${match.url}`);
  await automateProcess(match, order, whatsappNumber, userId);
};

const handleTSPSubmission = async (match, order, whatsappNumber, userId) => {
  console.log(`Handling TSP Submission: ${match.url}`);
  await automateProcess(match, order, whatsappNumber, userId);
};

const handleSpringerNature = async (match, order, whatsappNumber, userId) => {
  console.log(`Handling Springer Nature: ${match.url}`);
  await automateProcess(match, order, whatsappNumber, userId);
};

// Route to handle /capture requests
app.post("/capture", async (req, res) => {
  try {
    console.log("Capture request received...");
    const { username } = req.body;
    console.log("Searching for:", username); // Add logging

    if (!username) {
      console.error("Missing required parameter: username");
      return res.status(400).json({
        error: "Missing required parameter. Please provide username",
      });
    }

    console.log("Querying database for user...");
    
    // First try to find by Personal_Email
    db.all(
      "SELECT Journal_Link as url, Username as username, Password as password FROM journal_data WHERE Personal_Email = ?",
      [username],
      async (err, emailRows) => {
        if (err) {
          console.error("Database error:", err);
          return res.status(500).json({ error: "Database error" });
        }

        if (emailRows && emailRows.length > 0) {
          console.log("Found by Personal_Email");
          // Process email matches
          await processRows(emailRows, res);
          return;
        }

        // If no results by Personal_Email, try Client_Name
        db.all(
          "SELECT Journal_Link as url, Username as username, Password as password FROM journal_data WHERE Client_Name = ?",
          [username],
          async (err, clientRows) => {
            if (err) {
              console.error("Database error:", err);
              return res.status(500).json({ error: "Database error" });
            }

            console.log("Found by Client_Name");
            await processRows(clientRows, res);
          }
        );
      }
    );
  } catch (err) {
    console.error("Error in capture request:", err);
    return res.status(500).json({ error: err.message });
  }
});

// Helper function to process rows
async function processRows(rows, res) {
  if (!rows || rows.length === 0) {
    return res.status(404).json({
      error: "Account not found",
      message: "No account information found for the provided identifier. Please verify your Client Name or Email address and try again."
    });
  }

  let matches = rows.map(row => ({
    url: row.url ? decrypt(row.url) : '',
    username: row.username ? decrypt(row.username) : '',
    password: row.password ? decrypt(row.password) : ''
  })).filter(match => match.url && match.username && match.password);

  if (matches.length === 0) {
    return res.status(404).json({
      error: "Incomplete credentials",
      message: "We found your account, but there appear to be missing or incomplete journal credentials. Please contact support for assistance."
    });
  }

  // Process each match
  for (const [index, match] of matches.entries()) {
    await handleJournal(match, index + 1, whatsappNumber);
  }

  res.status(200).json({
    message: "Automation completed successfully for all links",
    processedCount: matches.length
  });
}

// Function to automate the process for a given match
const automateProcess = async (match, order, whatsappNumber, userId) => {
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
    await driver.get(match.url);
    await driver.sleep(5000);
    
    // Pass session to executeInstructions
    await executeInstructions(driver, match.username, match.password, order, match.url, whatsappNumber, userId);
    
  } catch (error) {
    console.error("Automation error:", error);
  } finally {
    await SessionManager.cleanupSession(sessionId);
  }
};

// Add session cleanup on intervals
setInterval(() => {
  const MAX_SESSION_AGE = 30 * 60 * 1000; // 30 minutes
  const now = Date.now();
  
  for (const [sessionId, session] of SessionManager.sessions) {
    if (now - session.createdAt > MAX_SESSION_AGE) {
      SessionManager.cleanupSession(sessionId);
    }
  }
}, 5 * 60 * 1000); // Check every 5 minutes

// Add cleanup on process exit
process.on('exit', () => {
  // On exit, only clean up expired sessions
  screenshotManager.clearAllScreenshots();
});

process.on('SIGINT', () => {
  // On interrupt, only clean up expired sessions
  screenshotManager.clearAllScreenshots();
  process.exit();
});

// Add periodic cleanup
setInterval(() => {
  screenshotManager.clearAllScreenshots();
}, 15 * 60 * 1000); // Run every 15 minutes

// Add health check route
app.get('/', (req, res) => {
  res.status(200).json({
    status: 'ok',
    message: 'Server is running',
    timestamp: new Date().toISOString(),
    port: port
  });
});

// Update the test-decrypt endpoint
app.post("/test-decrypt", async (req, res) => {
  try {
    const { encryptedText } = req.body;
    
    if (!encryptedText) {
      return res.status(400).json({
        error: "Missing encryptedText in request body"
      });
    }

    console.log('Testing decryption for:', encryptedText);
    
    try {
      const decrypted = decrypt(encryptedText);
      res.json({
        input: encryptedText,
        decrypted: decrypted,
        config: {
          algorithm,
          keyLength: key.length,
          ivLength: iv.length
        }
      });
    } catch (error) {
      console.error('Decryption test error:', error);
      res.status(500).json({
        error: 'Decryption failed',
        message: error.message,
        input: encryptedText
      });
    }
  } catch (error) {
    console.error('Test endpoint error:', error);
    res.status(500).json({
      error: 'Test endpoint failed',
      message: error.message
    });
  }
});

// Add new status check endpoint
app.post("/check-status", async (req, res) => {
  try {
    const { username, phone_number } = req.body;
    
    if (!username || !phone_number) {
      return res.status(400).json({
        error: "Missing parameters",
        message: "Both username and phone_number are required"
      });
    }

    console.log(`Manual status check request for user: ${username} from: ${phone_number}`);

    // Use the same screenshot request handler as webhook
    await handleScreenshotRequest(username, phone_number);

    res.status(200).json({
      status: "success",
      message: "Status check initiated",
      details: {
        username: username,
        phone: phone_number,
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('Status check error:', error);
    res.status(500).json({
      error: 'Status check failed',
      message: error.message
    });
  }
});

// Add diagnostic endpoint
app.get('/crypto-info', (req, res) => {
  const info = {
    nodeVersion: process.version,
    opensslVersion: process.versions.openssl,
    algorithm: algorithm,
    keyLength: key.length,
    ivLength: iv.length,
    environment: {
      algorithm: process.env.ENCRYPTION_ALGORITHM,
      keyPresent: Boolean(process.env.ENCRYPTION_KEY),
      ivPresent: Boolean(process.env.ENCRYPTION_IV)
    }
  };
  res.json(info);
});

// Start the Express server
app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
