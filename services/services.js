// Core imports
import { Builder, By, Key, until } from "selenium-webdriver";
import chrome from "selenium-webdriver/chrome.js";
import fs from "fs";
import sqlite3 from "sqlite3";
import { performance } from "perf_hooks";
import crypto from "crypto";
import axios from "axios";
import FormData from "form-data";
import path from "path";
import { promisify } from 'util';
import PQueue from 'p-queue';
import { spawn } from 'child_process';
import dotenv from 'dotenv';
import { logger } from '../utils/Logger.js';
import { handleJournal } from '../handlers/journalHandlers.js';
import { 
    handleEditorialManagerCHKSTS,
    handleManuscriptCentralCHKSTS,
    handleTandFOnlineCHKSTS,
    handleTaylorFrancisCHKSTS,
    handleCGScholarCHKSTS,
    handleTheSciPubCHKSTS,
    handleWileyCHKSTS,
    handlePeriodicosCHKSTS,
    handleTSPSubmissionCHKSTS,
    handleSpringerNatureCHKSTS 
} from '../handlers/chkstsHandlers.js';
import { v4 as uuidv4 } from 'uuid';
import { dbService } from './dbService.js';

// Load environment variables first
dotenv.config();

// Verify environment variables are loaded
if (!process.env.ENCRYPTION_KEY || !process.env.ENCRYPTION_IV || !process.env.ENCRYPTION_ALGORITHM) {
    throw new Error('Required encryption environment variables are not set');
}

// Core configuration
const algorithm = process.env.ENCRYPTION_ALGORITHM;
const key = Buffer.from(process.env.ENCRYPTION_KEY, 'hex');
const iv = Buffer.from(process.env.ENCRYPTION_IV, 'hex');

// Initialize core services
const db = new sqlite3.Database(process.env.DB_PATH);
const requestQueue = new PQueue({ concurrency: 1 });
const queueStats = {
    total: 0,
    current: 0,
    getPosition: (id) => queueStats.total - queueStats.current + 1
};

// User sessions and screenshot management
const userSessions = new Map();
const newlyGeneratedScreenshots = new Set();
const processedMessages = new Set();

// Core functions
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

// Add this helper function near the top with other helper functions
async function waitForClickable(driver, element, maxAttempts = 3) {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
            // Try to click the element
            await element.click();
            return true;
        } catch (error) {
            if (error.name === 'ElementClickInterceptedError') {
                // Try to handle any overlays or consent dialogs
                try {
                    // Common consent dialog selectors
                    const consentSelectors = [
                        '.category-menu-switch-handler',
                        '#onetrust-accept-btn-handler',
                        '.cookie-consent-accept',
                        '[aria-label="Accept cookies"]'
                    ];

                    for (const selector of consentSelectors) {
                        try {
                            const overlay = await driver.findElement(By.css(selector));
                            await overlay.click();
                            await driver.sleep(1000);
                        } catch (e) {
                            // Ignore if selector not found
                            continue;
                        }
                    }

                    // Try clicking the original element again
                    await driver.sleep(1000);
                    continue;
                } catch (e) {
                    if (attempt === maxAttempts - 1) throw error;
                    await driver.sleep(1000);
                }
            } else {
                throw error;
            }
        }
    }
    return false;
}

// Screenshot manager
const screenshotManager = {
    baseFolder: process.env.SCREENSHOT_FOLDER || "screenshots",  // Default to screenshots folder
    sessions: new Map(),

    async init() {
        try {
            if (!fs.existsSync(this.baseFolder)) {
                fs.mkdirSync(this.baseFolder, {
                    recursive: true,
                    mode: 0o777 // Full read/write/execute permissions for everyone
                });
            } else {
                // Update permissions on existing folder
                fs.chmodSync(this.baseFolder, 0o777);
            }
        } catch (error) {
            console.error('Error initializing screenshot manager:', error);
            throw error;
        }
    },

    getUserFolder(userId) {
        if (!userId) {
            throw new Error("User ID is required to get user folder");
        }
        const userFolder = path.join(this.baseFolder, userId.replace(/[^a-zA-Z0-9]/g, '_'));
        if (!fs.existsSync(userFolder)) {
            // Create folder with full permissions
            fs.mkdirSync(userFolder, {
                recursive: true,
                mode: 0o777 // Full read/write/execute permissions for everyone
            });
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
            // Create session folder with full permissions
            fs.mkdirSync(sessionFolder, {
                recursive: true,
                mode: 0o777 // Full read/write/execute permissions for everyone
            });
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

            // Use the new deleteUserFolder method
            await this.deleteUserFolder(userId);

            // After sending screenshots and before cleanup
            await sendFeedbackRequest(whatsappNumber, userId);

        } catch (error) {
            console.error('Error in sendToWhatsApp:', error);
            throw error;
        }
    },

    async deleteUserFolder(userId) {
        if (!userId) {
            throw new Error("User ID is required to delete user folder");
        }

        try {
            const userFolder = this.getUserFolder(userId);
            if (fs.existsSync(userFolder)) {
                // Force removal of directory and all contents
                fs.rmSync(userFolder, {
                    recursive: true,
                    force: true
                });
                console.log(`Successfully deleted user folder: ${userFolder}`);
            }
            // Remove any session data
            this.sessions.delete(userId);
        } catch (error) {
            console.error(`Error deleting user folder for ${userId}:`, error);
        }
    },

    // Replace clearSession with simplified version
    clearSession(userId) {
        if (!userId) return;
        this.deleteUserFolder(userId);
    },

    // Remove the clear() method as it's no longer needed

    // Modify clearAllScreenshots to be safer
    clearAllScreenshots() {
        // Only clean up sessions that are older than 30 minutes
        const MAX_SESSION_AGE = 30 * 60 * 1000; // 30 minutes
        const now = Date.now();

        for (const [userId, session] of this.sessions.entries()) {
            if (now - session.lastAccessed > MAX_SESSION_AGE) {
                try {
                    const userFolder = this.getUserFolder(userId);
                    if (fs.existsSync(userFolder)) {
                        fs.rmSync(userFolder, { recursive: true, force: true });
                    }
                    this.sessions.delete(userId);
                } catch (error) {
                    console.error(`Error cleaning up old session for user ${userId}:`, error);
                }
            }
        }
    }
};

// Session manager
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

// Core instruction execution
async function executeInstructions(driver, username, password, order, journalLink, whatsappNumber, userId) {
    try {
        const startTime = performance.now();
        console.log("Execution started...");

        // Determine the keys file based on the journal link
        let keysFile;
        if (journalLink.includes("manuscriptcentral")) {
            keysFile = "keys/manus_KEYS.txt";
        } else if (journalLink.includes("editorialmanager")) {
            keysFile = "keys/edito_KEYS.txt";
        // } else if (journalLink.includes("tandfonline")) {
        } else if (journalLink.includes("taylorfrancis") || journalLink.includes("tandfonline")) {
            keysFile = "keys/taylo_KEYS.txt";
        } else if (journalLink.includes("cgscholar")) {
            keysFile = "keys/cgsch_KEYS.txt";
        } else if (journalLink.includes("thescipub")) {
            keysFile = "keys/thesc_KEYS.txt";
        } else if (journalLink.includes("wiley")) {
            keysFile = "keys/wiley_KEYS.txt";
        } else if (journalLink.includes("periodicos")) {
            keysFile = "keys/perio_KEYS.txt";
        } else if (journalLink.includes("tspsubmission")) {
            keysFile = "keys/tspsu_KEYS.txt";
        } else if (journalLink.includes("springernature")) {
            keysFile = "keys/springer_KEYS.txt";
        } else if (journalLink.includes("wiley.scienceconnect.io") || journalLink.includes("onlinelibrary.wiley")) {
            keysFile = "keys/wiley_KEYS.txt";
        } else {
            throw new Error(`No keys file defined for URL: ${journalLink}`);
        }

        // Read and filter instructions
        const rawInstructions = fs.readFileSync(keysFile, "utf-8").split("\n");
        const instructions = rawInstructions.filter(line => {
            const trimmed = line.trim();
            return trimmed && trimmed.length > 0; // Only keep non-empty lines
        });

        const foundTexts = [];

        for (const [index, instruction] of instructions.entries()) {
            const trimmedInstruction = instruction.trim();
            
            // Skip empty lines or whitespace
            if (!trimmedInstruction) {
                continue;
            }

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
                // await driver.sleep(2000);
            } else if (trimmedInstruction === "SPACE") {
                await driver.actions().sendKeys(Key.SPACE).perform();
            } else if (trimmedInstruction === "ESC") {
                await driver.actions().sendKeys(Key.ESCAPE).perform();
            } else if (trimmedInstruction === "ENTER") {
                await driver.actions().sendKeys(Key.RETURN).perform();
            } else if (trimmedInstruction === "FIND") {
                await driver.actions().keyDown(Key.CONTROL).perform();
                await driver.actions().sendKeys("f").perform();
                await driver.actions().keyUp(Key.CONTROL).perform();
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
                
                // Use the new waitForClickable function instead of direct click
                await waitForClickable(driver, inputElement);
                console.log(`Clicked on element with target: ${clickTarget}`);
            } else if (trimmedInstruction === "CHKREGQS") {
                console.log("Handling survey popup check...");
                try {
                    // Click on body first to ensure focus
                    const body = await driver.findElement(By.tagName('body'));
                    await body.click();
                    await driver.sleep(1000);

                    const targetText = "Self-report your data to improve equity in research";
                    let found = false;

                    // Store main window handle at the start
                    const mainWindow = await driver.getWindowHandle();

                    // Do first 2 tabs and check
                    for (let i = 0; i < 2; i++) {
                        await driver.actions().sendKeys(Key.TAB).perform();
                        let activeElement = await switchToActiveElement(driver);
                        let text = await activeElement.getText();
                        console.log(`Tab ${i + 1} focused text:`, text || '[No text]');

                        // Check specifically on second tab
                        if (i === 1) {
                            if (text.includes(targetText)) {
                                console.log("Found target text at second tab");
                                found = true;

                                // Press enter to open popup
                                await driver.actions().sendKeys(Key.RETURN).perform();
                                // await driver.sleep(5000);
                                console.log("Window opened.........");

                                // Get all window handles after popup opens
                                const handles = await driver.getAllWindowHandles();

                                // Switch to popup window (last window in handles array)
                                if (handles.length > 1) {
                                    const popupWindow = handles[handles.length - 1];
                                    await driver.switchTo().window(popupWindow);
                                    await driver.close(); 
                                    console.log("Window closed.........");
                                }

                                // Switch back to main window
                                await driver.switchTo().window(mainWindow);
                                await driver.sleep(1000);

                                // Ensure we're back on the main window
                                console.log("Switching focus back to main window");
                                await body.click();
                                await driver.sleep(1000);

                                // Do 2 tabs
                                for (let i = 0; i < 4; i++) {
                                    await driver.actions().sendKeys(Key.TAB).perform();
                                    // await driver.sleep(2000);
                                    // console.log(`Tab ${i + 1} focused`);
                                }
                                // Press enter
                                await driver.actions().sendKeys(Key.RETURN).perform();
                                await driver.navigate().refresh();
                                console.log("Page reloaded after survey completion");
                                await driver.sleep(5000);
                                break;
                            } else {
                                console.log("Target text not found at second tab, doing reverse tabs");
                                // await driver.sleep(5000);

                                // Do 2 reverse tabs
                                // for (let j = 0; j < 2; j++) {
                                //   await driver.actions()
                                //     .keyDown(Key.SHIFT)
                                //     .sendKeys(Key.TAB)
                                //     .keyUp(Key.SHIFT)
                                //     .perform();
                                //   await driver.sleep(5000);
                                // }
                                await driver.navigate().refresh();
                                console.log("Page reloaded after survey completion");
                                await driver.sleep(5000);
                                break;
                            }

                        }
                    }

                    console.log("Survey check sequence completed");

                } catch (error) {
                    console.log("Error during survey popup check:", error);
                    try {
                        // Attempt to recover by switching to any available window
                        const handles = await driver.getAllWindowHandles();
                        if (handles.length > 0) {
                            await driver.switchTo().window(handles[0]);
                        }
                    } catch (recoveryError) {
                        console.log("Could not recover window focus:", recoveryError);
                    }
                }
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
                } else if (journalLink.includes("wiley")) {
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
                // await driver.sleep(200000); // Add a delay to ensure the element is focused
            }
        }

        const totalTime = ((performance.now() - startTime) / 1000).toFixed(2);
        console.log(`Execution completed in ${totalTime} seconds.`);
    } catch (error) {
        console.error("Error during instruction execution:", error);
        // Ensure screenshots are still sent even if there's an error
        await screenshotManager.sendToWhatsApp(whatsappNumber, userId);
    }
}

// WhatsApp message functions
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
                caption: ''
            }
        };

        await sendWhatsAppMessage(to, message);
    } catch (error) {
        console.error('Error sending WhatsApp image:', error);
        throw error;
    }
}

// Screenshot handling
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

async function handleScreenshotRequest(username, whatsappNumber) {
    const requestId = uuidv4();
    const startTime = new Date();
    
    await logger.logUserRequest({
        requestId,
        from: whatsappNumber,
        searchQuery: username,
        startTime: startTime.toISOString(),
        status: 'queued',
        queuePosition: requestQueue.size + 1
    });

    return requestQueue.add(async () => {
        try {
            queueStats.current++;
            
            // Send queue position message
            // if (requestQueue.size > 0) {
            //   await sendWhatsAppMessage(whatsappNumber, {
            //     messaging_product: "whatsapp",
            //     to: whatsappNumber,
            //     type: "text",
            //     text: { 
            //       body: `Your request is in queue (Position: ${queueStats.getPosition(requestId)}). We'll process it shortly.` 
            //     }
            //   });
            // }

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
            await screenshotManager.deleteUserFolder(username);

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
                            resolve({ rows: emailRows, searchType: 'email' });
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
                                    resolve({ rows: clientRows, searchType: 'client' });
                                }
                            }
                        );
                    }
                );
            });

            if (!rows.rows || rows.rows.length === 0) {
                await sendWhatsAppMessage(whatsappNumber, {
                    messaging_product: "whatsapp",
                    to: whatsappNumber,
                    type: "text",
                    text: { body: "No account information found for the provided identifier. Please verify your Client Name or Email address and try again." }
                });
                return;
            }

            // Send greeting with found information
            const searchTypeText = rows.searchType === 'email' ? 'email address' : 'client name';
            await sendWhatsAppMessage(whatsappNumber, {
                messaging_product: "whatsapp",
                to: whatsappNumber,
                type: "text",
                text: { 
                    body: `✓ Request received for ${username}\n` +
                          `Found ${rows.rows.length} journal(s) linked to your ${searchTypeText}.\n` +
                          `Processing your request...`
                }
            });

            // Process automation and generate new screenshots
            let matches = rows.rows.map(row => {

                // Try decryption with detailed logging
                let decrypted = {};
                try {
                    decrypted.url = row.url ? decrypt(row.url) : '';
                    // console.log('Decrypted URL:', decrypted.url);
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

            // Process matches in handleScreenshotRequest only
            if (matches.length > 0) {
                for (const [index, match] of matches.entries()) {
                    const journalStartTime = new Date().toISOString();
                    
                    try {
                        await handleJournal(match, index + 1, whatsappNumber, username);
                        
                        await logger.updateJournalStatus(requestId, {
                            url: match.url,
                            name: `Journal ${index + 1}`,
                            startTime: journalStartTime,
                            completionTime: new Date().toISOString(),
                            status: 'completed'
                        });
                    } catch (error) {
                        await logger.updateJournalStatus(requestId, {
                            url: match.url,
                            name: `Journal ${index + 1}`,
                            startTime: journalStartTime,
                            completionTime: new Date().toISOString(),
                            status: 'error',
                            error: error.message
                        });
                    }
                }
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

            // Log completion
            const endTime = new Date();
            const duration = (endTime - startTime) / 1000;

            await logger.logUserRequest({
                requestId,
                status: 'completed',
                completionTime: endTime.toISOString(),
                totalDuration: duration
            });

            // Return matches for webhook handler
            return { matches };

        } catch (error) {
            console.error(`Error processing request ${requestId}:`, error);
            // Log error
            const endTime = new Date();
            const duration = (endTime - startTime) / 1000;

            await logger.logUserRequest({
                requestId,
                status: 'error',
                error: error.message,
                completionTime: endTime.toISOString(),
                totalDuration: duration
            });
            throw error;
        } finally {
            queueStats.current--;
            // Cleanup
            await screenshotManager.deleteUserFolder(username);
            console.log(`Completed request ${requestId}`);
        }
    });
}

// Initialize services
screenshotManager.init();

// Cleanup intervals
setInterval(() => {
    const MAX_SESSION_AGE = 30 * 60 * 1000;
    const now = Date.now();
    
    for (const [sessionId, session] of SessionManager.sessions) {
        if (now - session.createdAt > MAX_SESSION_AGE) {
            SessionManager.cleanupSession(sessionId);
        }
    }
}, 5 * 60 * 1000);

setInterval(() => {
    screenshotManager.clearAllScreenshots();
}, 15 * 60 * 1000);

// Add automateProcess function definition
async function automateProcess(match, order, whatsappNumber, userId) {
    try {
        const options = new chrome.Options();
        options.addArguments([
            "--headless",
            "--no-sandbox",
            "--disable-dev-shm-usage",
            "--window-size=1920,1080",
            "--incognito"
        ]);

        const driver = await new Builder()
            .forBrowser('chrome')
            .setChromeOptions(options)
            .build();
            
        try {
            // Set maximum window size after browser creation
            await driver.manage().window().setRect({
                width: 1920,
                height: 1080,
                x: 0,
                y: 0
            });
            await driver.manage().window().maximize();
            
            await driver.get(match.url);
            
            // Handle cookie consent dialogs
            try {
                // Wait up to 5 seconds for any cookie dialog
                await driver.wait(async () => {
                    try {
                        // Common consent dialog selectors
                        const consentSelectors = [
                            '.category-menu-switch-handler',
                            '#onetrust-accept-btn-handler',
                            '.cookie-consent-accept',
                            '[aria-label="Accept cookies"]'
                        ];

                        for (const selector of consentSelectors) {
                            try {
                                const buttons = await driver.findElements(By.css(selector));
                                if (buttons.length > 0) {
                                    await buttons[0].click();
                                    await driver.sleep(1000);
                                    return true;
                                }
                            } catch (e) {
                                continue;
                            }
                        }
                        return true;
                    } catch (e) {
                        return true;
                    }
                }, 5000);
            } catch (cookieError) {
                console.log('Cookie consent handling completed or timed out');
            }
            
            await executeInstructions(
                driver, 
                match.username, 
                match.password, 
                order, 
                match.url, 
                whatsappNumber,
                userId
            );
        } finally {
            await driver.quit();
        }
    } catch (error) {
        console.error('Automation process error:', error);
        throw error;
    }
}

// Add processRows function
async function processRows(rows, res) {
    try {
        if (!rows || rows.length === 0) {
            return res.status(404).json({
                error: "No account information found",
                message: "Please verify your Client Name or Email address and try again"
            });
        }

        let matches = rows.map(row => {
            let decrypted = {};
            try {
                decrypted.url = row.url ? decrypt(row.url) : '';
                decrypted.username = row.username ? decrypt(row.username) : '';
                decrypted.password = row.password ? decrypt(row.password) : '';
            } catch (e) {
                console.error('Decryption error:', e);
            }
            return decrypted;
        }).filter(match => match.url && match.username && match.password);

        if (matches.length === 0) {
            return res.status(400).json({
                error: "Incomplete credentials",
                message: "Account found but credentials are incomplete or invalid"
            });
        }

        res.json({
            status: "success",
            count: matches.length,
            matches: matches
        });
    } catch (error) {
        console.error('Error processing rows:', error);
        res.status(500).json({ error: error.message });
    }
}

// Add missing initialization function
export function initializeServices() {
    return {
        db,
        decrypt,
        screenshotManager,
        SessionManager,
        requestQueue,
        queueStats,
        processedMessages,
        handleScreenshotRequest,
        sendWhatsAppMessage,
        sendWhatsAppImage,
        executeInstructions,
        algorithm,
        key,
        iv,
        automateProcess,
        processRows,
        // Add these missing function references
        getSession: SessionManager.getSession.bind(SessionManager),
        createSession: SessionManager.createSession.bind(SessionManager),
        cleanupSession: SessionManager.cleanupSession.bind(SessionManager),
        dbService
    };
}

// Export required functions and objects
export {
    db,
    decrypt,
    screenshotManager,
    SessionManager,
    requestQueue,
    queueStats,
    processedMessages,
    handleScreenshotRequest,
    sendWhatsAppMessage,
    sendWhatsAppImage,
    executeInstructions,
    algorithm,
    key,
    iv,
    automateProcess,
    processRows
};

// After screenshots are sent in sendToWhatsApp method, add feedback request
async function sendFeedbackRequest(whatsappNumber, username) {
    try {
        const messageId = uuidv4();
        await sendWhatsAppMessage(whatsappNumber, {
            messaging_product: "whatsapp",
            to: whatsappNumber,
            type: "interactive",
            interactive: {
                type: "button",
                body: {
                    text: "Did you get the correct status update?"
                },
                action: {
                    buttons: [
                        {
                            type: "reply",
                            reply: {
                                id: `yes_${username}_${messageId}`,
                                title: "Yes"
                            }
                        },
                        {
                            type: "reply",
                            reply: {
                                id: `no_${username}_${messageId}`,
                                title: "No"
                            }
                        }
                    ]
                }
            }
        });
        
        // Log feedback request to database
        await dbService.logFeedback({
            userId: username,
            whatsappNumber,
            messageId,
            status: 'pending'
        });
        
        return messageId;
    } catch (error) {
        console.error('Error sending feedback request:', error);
    }
}

// Add function to handle reprocessing
async function reprocessRequest(username, whatsappNumber) {
    return handleScreenshotRequest(username, whatsappNumber);
}

// Update exports
export {
    reprocessRequest,
    sendFeedbackRequest
};