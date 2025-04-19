import { Builder, By, Key } from "selenium-webdriver";
import chrome from "selenium-webdriver/chrome.js";
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

// Import shared utilities
import { 
    screenshotManager, 
    SessionManager, 
    automateProcess 
} from '../services/services.js';

// Updated path resolution for virtual environment (Windows-compatible)
const VENV_PYTHON = process.platform === 'win32'
    ? path.join(process.cwd(), '.venv', 'Scripts', 'python.exe')  // Windows path
    : path.join(process.cwd(), '.venv', 'bin', 'python');        // Unix path

// Function to get Python executable path
function getPythonPath() {
    // First try the virtual environment
    if (fs.existsSync(VENV_PYTHON)) {
        return VENV_PYTHON;
    }
    
    // Fallback to system Python
    return process.platform === 'win32' ? 'python' : 'python3';
}

// Journal handler functions
export const handleManuscriptCentral = async (match, order, whatsappNumber, userId) => {
    await automateProcess(match, order, whatsappNumber, userId);
};

export const handleEditorialManager = async (match, order, whatsappNumber, userId) => {
    await automateProcess(match, order, whatsappNumber, userId);
};

export const handleTandFOnline = async (match, order, whatsappNumber, userId) => {
    const sessionId = SessionManager.createSession(userId);  // Use userId instead of whatsappNumber
    
    try {
        console.log(`Starting TandF automation with SeleniumBase`);
        
        // Verify keys file exists
        const keysFile = path.join(process.cwd(), 'keys', 'taylo_KEYS.txt');
        if (!fs.existsSync(keysFile)) {
            console.error(`Keys file not found at ${keysFile}`);
            throw new Error('TandF configuration file missing');
        }
        console.log(`Using keys file: ${keysFile}`);

        // Create screenshots directory if it doesn't exist
        if (!fs.existsSync('screenshots')) {
            fs.mkdirSync('screenshots', { recursive: true });
        }

        const result = await new Promise((resolve, reject) => {
            // Use virtual environment Python
            const pythonProcess = spawn(VENV_PYTHON, [
                'handlers/tandf_handler.py',
                match.url,
                match.username,
                match.password
            ]);

            let stdoutData = '';
            let stderrData = '';

            pythonProcess.stdout.on('data', (data) => {
                stdoutData += data.toString();
                console.log('Python output:', data.toString());
            });

            pythonProcess.stderr.on('data', (data) => {
                stderrData += data.toString();
                console.error('Python error:', data.toString());
            });

            pythonProcess.on('close', (code) => {
                if (code !== 0) {
                    reject(new Error(`Process exited with code ${code}: ${stderrData}`));
                    return;
                }

                try {
                    const lastLine = stdoutData.trim().split('\n').pop();
                    const result = JSON.parse(lastLine);
                    resolve(result);
                } catch (e) {
                    console.error('JSON parse error:', e);
                    reject(new Error('Failed to parse Python output'));
                }
            });
        });

        if (result.status === 'success' && Array.isArray(result.screenshots)) {
            // Ensure user session exists and create the session directory
            const userSession = screenshotManager.sessions.get(userId) || screenshotManager.createSession(userId);
            
            // Ensure the user session folder exists
            if (!fs.existsSync(userSession.folder)) {
                fs.mkdirSync(userSession.folder, { recursive: true });
                console.log(`Created user session folder: ${userSession.folder}`);
            }

            for (const screenshot of result.screenshots) {
                const screenshotPath = path.resolve(screenshot); // Get absolute path
                console.log(`Processing screenshot at absolute path: ${screenshotPath}`);
                
                if (fs.existsSync(screenshotPath)) {
                    try {
                        const screenshotContent = fs.readFileSync(screenshotPath);
                        const timestamp = new Date().toISOString().replace(/[-:.]/g, "");
                        const filename = `tandf_status_${timestamp}.png`;
                        const filepath = path.join(userSession.folder, filename);
                        
                        console.log(`Writing screenshot to: ${filepath}`);
                        fs.writeFileSync(filepath, screenshotContent);
                        userSession.screenshots.add(filepath);
                        
                        // Only delete original after successful copy
                        fs.unlinkSync(screenshotPath);
                        console.log(`Deleted original screenshot: ${screenshotPath}`);
                    } catch (error) {
                        console.error(`Error processing screenshot ${screenshotPath}:`, error);
                    }
                } else {
                    console.warn(`Screenshot file not found: ${screenshotPath}`);
                    console.warn(`Current working directory: ${process.cwd()}`);
                    console.warn(`Files in screenshots directory:`, fs.readdirSync('screenshots'));
                }
            }
            
            // Only send to WhatsApp if a phone number is provided
            if (whatsappNumber) {
                await screenshotManager.sendToWhatsApp(whatsappNumber, userId);
            }
        } else {
            throw new Error(result.error || 'Failed to get screenshots');
        }

    } catch (error) {
        console.error("TandF automation error:", error);
        throw error;  // Rethrow for proper handling upstream
    } finally {
        // Only cleanup session if it's a WhatsApp request
        if (whatsappNumber) {
            await SessionManager.cleanupSession(sessionId);
        }
    }
};

export const handleTaylorFrancis = async (match, order, whatsappNumber, userId) => {
    await automateProcess(match, order, whatsappNumber, userId);
};

export const handleCGScholar = async (match, order, whatsappNumber, userId) => {
    await automateProcess(match, order, whatsappNumber, userId);
};

export const handleTheSciPub = async (match, order, whatsappNumber, userId) => {
    await automateProcess(match, order, whatsappNumber, userId);
};

export const handleWiley = async (match, order, whatsappNumber, userId) => {
    const sessionId = SessionManager.createSession(userId);  // Use userId instead of whatsappNumber
    
    try {
        console.log(`Starting Wiley automation with SeleniumBase`);
        
        if (!fs.existsSync('screenshots')) {
            fs.mkdirSync('screenshots', { recursive: true });
        }

        const pythonPath = getPythonPath();
        console.log(`Using Python executable: ${pythonPath}`);
        
        // Resolve handler path relative to current file
        const handlerPath = path.join(process.cwd(), 'handlers', 'wiley_handler.py');
        console.log(`Using handler script: ${handlerPath}`);

        if (!fs.existsSync(handlerPath)) {
            throw new Error(`Handler script not found: ${handlerPath}`);
        }

        const result = await new Promise((resolve, reject) => {
            const pythonProcess = spawn(pythonPath, [
                handlerPath,
                match.url,
                match.username,
                match.password
            ], {
                stdio: ['pipe', 'pipe', 'pipe'],
                shell: process.platform === 'win32'  // Use shell on Windows
            });

            let stdoutData = '';
            let stderrData = '';

            pythonProcess.stdout.on('data', (data) => {
                stdoutData += data.toString();
                console.log('Python output:', data.toString());
            });

            pythonProcess.stderr.on('data', (data) => {
                stderrData += data.toString();
                console.error('Python error:', data.toString());
            });

            pythonProcess.on('close', (code) => {
                if (code !== 0) {
                    reject(new Error(`Process exited with code ${code}: ${stderrData}`));
                    return;
                }

                try {
                    const lastLine = stdoutData.trim().split('\n').pop();
                    const result = JSON.parse(lastLine);
                    resolve(result);
                } catch (e) {
                    console.error('JSON parse error:', e);
                    reject(new Error('Failed to parse Python output'));
                }
            });
        });

        if (result.status === 'success' && Array.isArray(result.screenshots)) {
            const userSession = screenshotManager.sessions.get(userId) || screenshotManager.createSession(userId);

            for (const screenshot of result.screenshots) {
                if (fs.existsSync(screenshot)) {
                    const screenshotContent = fs.readFileSync(screenshot);
                    const timestamp = new Date().toISOString().replace(/[-:.]/g, "");
                    const filename = `wiley_status_${timestamp}.png`;
                    const filepath = path.join(userSession.folder, filename);

                    fs.writeFileSync(filepath, screenshotContent);
                    userSession.screenshots.add(filepath);
                    fs.unlinkSync(screenshot);
                }
            }

            // Only send WhatsApp message if whatsappNumber is provided
            if (whatsappNumber) {
                await screenshotManager.sendToWhatsApp(whatsappNumber, userId);
            }
        } else {
            throw new Error(result.error || 'Failed to get screenshots');
        }

    } catch (error) {
        console.error("Wiley automation error:", error);
        throw error;  // Rethrow the error for proper handling upstream
    } finally {
        // Only cleanup session if it's a WhatsApp request
        if (whatsappNumber) {
            await SessionManager.cleanupSession(sessionId);
        }
    }
};

export const handlePeriodicos = async (match, order, whatsappNumber, userId) => {
    await automateProcess(match, order, whatsappNumber, userId);
};

export const handleTSPSubmission = async (match, order, whatsappNumber, userId) => {
    await automateProcess(match, order, whatsappNumber, userId);
};

export const handleSpringerNature = async (match, order, whatsappNumber, userId) => {
    await automateProcess(match, order, whatsappNumber, userId);
};

export const handleMedknowOnline = async (match, order, whatsappNumber, userId) => {
    const sessionId = SessionManager.createSession(userId);
    
    try {
        console.log(`Starting Medknow automation with SeleniumBase`);
        
        // Verify keys file exists
        const keysFile = path.join(process.cwd(), 'keys', 'medknow_KEYS.txt');
        if (!fs.existsSync(keysFile)) {
            console.error(`Keys file not found at ${keysFile}`);
            throw new Error('Medknow configuration file missing');
        }
        console.log(`Using keys file: ${keysFile}`);

        // Create screenshots directory if it doesn't exist
        if (!fs.existsSync('screenshots')) {
            fs.mkdirSync('screenshots', { recursive: true });
        }

        // Create user session directory immediately
        const userSession = screenshotManager.sessions.get(userId) || screenshotManager.createSession(userId);
        if (!fs.existsSync(userSession.folder)) {
            fs.mkdirSync(userSession.folder, { recursive: true });
            console.log(`Created user session folder: ${userSession.folder}`);
        }

        // Resolve handler path relative to current file
        const handlerPath = path.join(process.cwd(), 'handlers', 'medknow_handler.py');
        console.log(`Using handler script: ${handlerPath}`);

        if (!fs.existsSync(handlerPath)) {
            throw new Error(`Handler script not found: ${handlerPath}`);
        }

        const pythonPath = getPythonPath();
        console.log(`Using Python executable: ${pythonPath}`);

        const result = await new Promise((resolve, reject) => {
            const pythonProcess = spawn(pythonPath, [
                handlerPath,
                match.url,
                match.username,
                match.password,
                userSession.folder  // Pass user session folder as 4th arg
            ], {
                stdio: ['pipe', 'pipe', 'pipe'],
                shell: process.platform === 'win32'  // Use shell on Windows
            });

            let stdoutData = '';
            let stderrData = '';

            pythonProcess.stdout.on('data', (data) => {
                stdoutData += data.toString();
                console.log('Python output:', data.toString());
            });

            pythonProcess.stderr.on('data', (data) => {
                stderrData += data.toString();
                console.error('Python error:', data.toString());
            });

            pythonProcess.on('close', (code) => {
                if (code !== 0) {
                    reject(new Error(`Process exited with code ${code}: ${stderrData}`));
                    return;
                }

                try {
                    const lastLine = stdoutData.trim().split('\n').pop();
                    const result = JSON.parse(lastLine);
                    resolve(result);
                } catch (e) {
                    console.error('JSON parse error:', e);
                    reject(new Error('Failed to parse Python output'));
                }
            });
        });

        if (result.status === 'success' && Array.isArray(result.screenshots)) {
            // Just register the screenshots in the session - they're already in the right folder
            for (const screenshot of result.screenshots) {
                if (fs.existsSync(screenshot)) {
                    userSession.screenshots.add(screenshot);
                    console.log(`Added screenshot to session: ${screenshot}`);
                } else {
                    console.warn(`Screenshot does not exist: ${screenshot}`);
                }
            }
            
            // Only send to WhatsApp if a phone number is provided
            if (whatsappNumber) {
                await screenshotManager.sendToWhatsApp(whatsappNumber, userId);
            }
        } else {
            throw new Error(result.error || 'Failed to get screenshots');
        }

    } catch (error) {
        console.error("Medknow automation error:", error);
        throw error;  // Rethrow for proper handling upstream
    } finally {
        // Only cleanup session if it's a WhatsApp request
        if (whatsappNumber) {
            await SessionManager.cleanupSession(sessionId);
        }
    }
};

export const handleJisemJournal = async (match, order, whatsappNumber, userId) => {
    await automateProcess(match, order, whatsappNumber, userId);
};

export const handlePleiadesOnline = async (match, order, whatsappNumber, userId) => {
    await automateProcess(match, order, whatsappNumber, userId);
};

// Unified handler for submit.*.org sites (AJSM, OJSM, etc.)
export const handleSubmitOrg = async (match, order, whatsappNumber, userId) => {
    const url = match.url.toLowerCase();
    const domain = url.match(/submit\.([a-z]+)\.org/);
    const journalCode = domain ? domain[1].toUpperCase() : 'GENERIC';
    
    console.log(`Starting ${journalCode} automation using common submit_org handler`);
    
    // Always use the shared submit_org keys file for all submit.*.org sites
    const keysFile = "keys/submit_org_KEYS.txt";
    console.log(`Using shared keys file: ${keysFile}`);
    
    // Use the shared automation process
    await automateProcess(match, order, whatsappNumber, userId, keysFile);
};

// Main journal handler function
export const handleJournal = async (match, order, whatsappNumber, userId) => {
    try {
        const url = match.url.toLowerCase();
        // For upload-status requests, whatsappNumber might be null
        const isUploadRequest = !whatsappNumber;

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
        } else if (url.includes("wiley")) {
            await handleWiley(match, order, whatsappNumber, userId);
        } else if (url.includes("periodicos")) {
            await handlePeriodicos(match, order, whatsappNumber, userId);
        } else if (url.includes("tspsubmission")) {
            await handleTSPSubmission(match, order, whatsappNumber, userId);
        } else if (url.includes("springernature")) {
            await handleSpringerNature(match, order, whatsappNumber, userId);
        } else if (url.includes("medknow") || url.includes("review.jow")) {
            await handleMedknowOnline(match, order, whatsappNumber, userId);
        } else if (url.includes("jisem-journal")) {
            await handleJisemJournal(match, order, whatsappNumber, userId);
        } else if (url.includes("pleiadesonline")) {
            await handlePleiadesOnline(match, order, whatsappNumber, userId);
        } else if (url.match(/submit\.[a-z]+\.org/)) {
            // Unified handler for all submit.*.org domains
            await handleSubmitOrg(match, order, whatsappNumber, userId);
        } else {
            throw new Error(`No handler for URL: ${match.url}`);
        }

        // For upload requests, return the screenshots from the session
        if (isUploadRequest) {
            const userSession = screenshotManager.sessions.get(userId);
            if (userSession) {
                return Array.from(userSession.screenshots);
            }
        }
    } catch (error) {
        console.error(`Error in handleJournal: ${error.message}`);
        throw error;
    }
};
