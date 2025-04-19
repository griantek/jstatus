// Core imports
import { Builder, By, Key, until } from "selenium-webdriver";
import chrome from "selenium-webdriver/chrome.js";
import fs from "fs";
import { supabase } from '../config/supabase.js';
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

// Add this helper function to check if a file exists
async function fileExists(filePath) {
    try {
        await fs.promises.access(filePath, fs.constants.F_OK);
        return true;
    } catch (error) {
        return false;
    }
}

// Add this function to safely delete a directory
async function safelyDeleteDirectory(directoryPath) {
    if (!fs.existsSync(directoryPath)) {
        return;
    }
    
    try {
        // Read all items in the directory
        const items = await fs.promises.readdir(directoryPath);
        
        // Process each item (file or subdirectory)
        for (const item of items) {
            const itemPath = path.join(directoryPath, item);
            const stats = await fs.promises.stat(itemPath);
            
            if (stats.isDirectory()) {
                // Recursively delete subdirectory
                await safelyDeleteDirectory(itemPath);
            } else {
                // Delete file
                try {
                    fs.unlinkSync(itemPath);
                } catch (err) {
                    console.log(`Could not delete file ${itemPath}: ${err.message}`);
                }
            }
        }
        
        // Now that the directory is empty, delete it
        try {
            fs.rmdirSync(directoryPath);
        } catch (err) {
            console.log(`Could not delete directory ${directoryPath}: ${err.message}`);
            // Try with rmSync as a fallback
            try {
                fs.rmSync(directoryPath, { force: true });
            } catch (innerErr) {
                console.log(`Final attempt to delete directory failed: ${innerErr.message}`);
            }
        }
    } catch (error) {
        console.error(`Error in safelyDeleteDirectory: ${error.message}`);
    }
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
            
            // Get the target directory from the session
            const targetDir = session.folder;
            
            // Ensure the directory exists
            if (!fs.existsSync(targetDir)) {
                fs.mkdirSync(targetDir, { recursive: true });
                console.log(`Created screenshot directory: ${targetDir}`);
            }

            const filepath = path.join(targetDir, filename);
            console.log(`Attempting to save screenshot to: ${filepath}`);

            try {
                const image = await driver.takeScreenshot();
                await fs.promises.writeFile(filepath, image, 'base64');
                session.screenshots.add(filepath);
                console.log(`Screenshot saved successfully: ${filepath}`);
                return filepath;
            } catch (screenshotError) {
                console.error('Failed to capture or save screenshot:', screenshotError);
                throw screenshotError;
            }
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
                await safelyDeleteDirectory(userFolder);
                console.log(`Successfully deleted user folder: ${userFolder}`);
            }
            // Remove any session data
            this.sessions.delete(userId);
        } catch (error) {
            console.error(`Error deleting user folder for ${userId}:`, error);
        }
    },

    clearSession(userId) {
        if (!userId) return;
        const userFolder = this.getUserFolder(userId);
        if (fs.existsSync(userFolder)) {
            safelyDeleteDirectory(userFolder)
                .then(() => console.log(`Session cleared for user: ${userId}`))
                .catch(err => console.error(`Error clearing session for user ${userId}:`, err));
        }
        this.sessions.delete(userId);
    },

    clearAllScreenshots() {
        // Only clean up sessions that are older than 30 minutes
        const MAX_SESSION_AGE = 30 * 60 * 1000; // 30 minutes
        const now = Date.now();

        for (const [userId, session] of this.sessions.entries()) {
            if (now - session.lastAccessed > MAX_SESSION_AGE) {
                try {
                    const userFolder = this.getUserFolder(userId);
                    if (fs.existsSync(userFolder)) {
                        safelyDeleteDirectory(userFolder)
                            .then(() => console.log(`Old session cleaned for user: ${userId}`))
                            .catch(err => console.error(`Error cleaning old session for user ${userId}:`, err));
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
async function executeInstructions(driver, username, password, order, journalLink, whatsappNumber, userId, customKeysFile = null) {
    try {
        const startTime = performance.now();
        console.log("Execution started...");

        // Use custom keys file if provided, otherwise determine based on the journal link
        let keysFile = customKeysFile;
        if (!keysFile) {
            if (journalLink.includes("manuscriptcentral")) {
                keysFile = "keys/manus_KEYS.txt";
            } else if (journalLink.includes("editorialmanager")) {
                keysFile = "keys/edito_KEYS.txt";
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
            } else if (journalLink.includes("medknow") || journalLink.includes("review.jow")) {
                keysFile = "keys/medknow_KEYS.txt";
            } else if (journalLink.includes("jisem-journal")) {
                keysFile = "keys/jisem_KEYS.txt";
            } else if (journalLink.includes("pleiadesonline")) {
                keysFile = "keys/pleiades_KEYS.txt";
            } else if (journalLink.match(/submit\.[a-z]+\.org/)) {
                keysFile = "keys/submit_org_KEYS.txt";
            } else if (journalLink.includes("peerreview.sagepub")) {
                keysFile = "keys/sage_KEYS.txt";
            } else {
                throw new Error(`No keys file defined for URL: ${journalLink}`);
            }
        }
        
        console.log(`Using keys file: ${keysFile}`);

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

            if (trimmedInstruction === "TAB") {
                await driver.actions().sendKeys(Key.TAB).perform();
                await driver.sleep(1000);
            } else if (trimmedInstruction === "SPACE") {
                await driver.actions().sendKeys(Key.SPACE).perform();
            } else if (trimmedInstruction === "ESC") {
                await driver.actions().sendKeys(Key.ESCAPE).perform();
            } else if (trimmedInstruction === "ENTER") {
                await driver.actions().sendKeys(Key.RETURN).perform();
            } else if (trimmedInstruction === "UP") {
                await driver.actions().sendKeys(Key.ARROW_UP).perform();
            } else if (trimmedInstruction === "DOWN") {
                await driver.actions().sendKeys(Key.ARROW_DOWN).perform();
            } else if (trimmedInstruction === "LEFT") {
                await driver.actions().sendKeys(Key.ARROW_LEFT).perform();
            } else if (trimmedInstruction === "RIGHT") {
                await driver.actions().sendKeys(Key.ARROW_RIGHT).perform();
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
                    // console.log(`Unknown CLICK target: ${clickTarget}`);
                    // continue;
                    inputElement = await driver.findElement(By.id("MainContent"));
                }
                
                await waitForClickable(driver, inputElement);
                console.log(`Clicked on element with target: ${clickTarget}`);
            } else if (trimmedInstruction === "CHKREGQS") {
                console.log("Handling survey popup check...");
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
                        console.log(`Tab ${i + 1} focused text:`, text || '[No text]');

                        if (i === 1) {
                            if (text.includes(targetText)) {
                                console.log("Found target text at second tab");
                                found = true;

                                await driver.actions().sendKeys(Key.RETURN).perform();
                                console.log("Window opened.........");

                                const handles = await driver.getAllWindowHandles();

                                if (handles.length > 1) {
                                    const popupWindow = handles[handles.length - 1];
                                    await driver.switchTo().window(popupWindow);
                                    await driver.close(); 
                                    console.log("Window closed.........");
                                }

                                await driver.switchTo().window(mainWindow);
                                await driver.sleep(1000);

                                console.log("Switching focus back to main window");
                                await body.click();
                                await driver.sleep(1000);

                                for (let i = 0; i < 4; i++) {
                                    await driver.actions().sendKeys(Key.TAB).perform();
                                }
                                await driver.actions().sendKeys(Key.RETURN).perform();
                                await driver.navigate().refresh();
                                console.log("Page reloaded after survey completion");
                                await driver.sleep(5000);
                                break;
                            } else {
                                console.log("Target text not found at second tab, doing reverse tabs");
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
                    await driver.sleep(20000);
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
            }
        }

        if (journalLink.includes("medknow") || journalLink.includes("review.jow")) {
            console.log("Taking final screenshot after completing all Medknow instructions...");
            await driver.sleep(3000);
            
            try {
                const finalScreenshot = await screenshotManager.capture(driver, `${username}_final`, userId);
                console.log(`Final Medknow screenshot saved at: ${finalScreenshot}`);
            } catch (screenshotError) {
                console.error("Error capturing final screenshot:", screenshotError);
            }
        }

        const totalTime = ((performance.now() - startTime) / 1000).toFixed(2);
        console.log(`Execution completed in ${totalTime} seconds.`);
    } catch (error) {
        console.error("Error during instruction execution:", error);
        if (whatsappNumber) {
            await screenshotManager.sendToWhatsApp(whatsappNumber, userId);
        }
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
            
            console.log(`Processing request ${requestId} for user ${username}`);

            let session = userSessions.get(username);
            if (!session) {
                session = {
                    id: uuidv4(),
                    createdAt: Date.now(),
                    lastAccessed: Date.now()
                };
                userSessions.set(username, session);
            }

            session.lastAccessed = Date.now();

            await screenshotManager.deleteUserFolder(username);

            console.log("Searching for:", username);

            let { data: emailRows, error: emailError } = await supabase
                .from('journal_data')
                .select('journal_link as url, username, password')
                .eq('personal_email', username);

            if (emailError) throw emailError;

            if (!emailRows || emailRows.length === 0) {
                const { data: clientRows, error: clientError } = await supabase
                    .from('journal_data')
                    .select('journal_link as url, username, password')
                    .eq('client_name', username);

                if (clientError) throw clientError;
                emailRows = clientRows;
            }

            if (!emailRows || emailRows.length === 0) {
                await sendWhatsAppMessage(whatsappNumber, {
                    messaging_product: "whatsapp",
                    to: whatsappNumber,
                    type: "text",
                    text: { body: "No account information found for the provided identifier. Please verify your Client Name or Email address and try again." }
                });
                return;
            }

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

            let matches = rows.rows.map(row => {
                let decrypted = {};
                try {
                    decrypted.url = row.url ? decrypt(row.url) : '';
                } catch (e) {
                    console.error('URL decryption error:', e);
                    decrypted.url = '';
                }

                try {
                    decrypted.username = row.username ? decrypt(row.username) : '';
                } catch (e) {
                    console.error('Username decryption error:', e);
                    decrypted.username = '';
                }

                try {
                    decrypted.password = row.password ? decrypt(row.password) : '';
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

            await screenshotManager.sendToWhatsApp(whatsappNumber, username);

            newlyGeneratedScreenshots.clear();

            await sendWhatsAppMessage(whatsappNumber, {
                messaging_product: "whatsapp",
                to: whatsappNumber,
                type: "text",
                text: { body: "All new status updates have been sent." }
            });

            const endTime = new Date();
            const duration = (endTime - startTime) / 1000;

            await logger.logUserRequest({
                requestId,
                status: 'completed',
                completionTime: endTime.toISOString(),
                totalDuration: duration
            });

            return { matches };

        } catch (error) {
            console.error(`Error processing request ${requestId}:`, error);
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

async function automateProcess(match, order, whatsappNumber, userId, customKeysFile = null) {
    try {
        const options = new chrome.Options();
        
        options.addArguments([
            '--headless=new',
            '--no-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--disable-software-rasterizer',
            '--disable-extensions',
            '--disable-notifications',
            '--window-size=1920,1080',
            '--force-device-scale-factor=1',
            '--hide-scrollbars'
        ]);

        options.setUserPreferences({
            'profile.default_content_setting_values.notifications': 2,
            'profile.default_content_settings.popups': 0,
            'download.prompt_for_download': false
        });

        const driver = await new Builder()
            .forBrowser('chrome')
            .setChromeOptions(options)
            .build();
            
        try {
            await driver.sleep(1000);
            
            await driver.get(match.url);
            await driver.sleep(2000);
            
            await executeInstructions(
                driver, 
                match.username, 
                match.password, 
                order, 
                match.url, 
                whatsappNumber,
                userId,
                customKeysFile  // Pass the custom keys file
            );
        } finally {
            await driver.quit();
        }
    } catch (error) {
        console.error('Automation process error:', error);
        throw error;
    }
}

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

export function initializeServices() {
    return {
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
        fileExists,
        safelyDeleteDirectory,
        getSession: SessionManager.getSession.bind(SessionManager),
        createSession: SessionManager.createSession.bind(SessionManager),
        cleanupSession: SessionManager.cleanupSession.bind(SessionManager),
        dbService
    };
}

export {
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
    fileExists,
    safelyDeleteDirectory
};

async function sendFeedbackRequest(whatsappNumber, username) {
    try {
        if (!whatsappNumber) {
            console.log('Skipping feedback request - no WhatsApp number provided');
            return;
        }

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

async function reprocessRequest(username, whatsappNumber) {
    return handleScreenshotRequest(username, whatsappNumber);
}

export {
    reprocessRequest,
    sendFeedbackRequest
};