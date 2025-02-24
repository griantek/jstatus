import { Builder, By, Key } from "selenium-webdriver";
import chrome from "selenium-webdriver/chrome.js";
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

// Import shared utilities
import { 
    screenshotManager, 
    SessionManager, 
    automateProcess  // Now this will work because it's exported
} from '../services/services.js';

// Add path resolution for virtual environment
const VENV_PYTHON = process.env.VIRTUAL_ENV 
    ? path.join(process.env.VIRTUAL_ENV, 'bin', 'python')
    : path.join(process.cwd(), '.venv', 'bin', 'python');

// Journal handler functions
export const handleManuscriptCentral = async (match, order, whatsappNumber, userId) => {
    await automateProcess(match, order, whatsappNumber, userId);
};

export const handleEditorialManager = async (match, order, whatsappNumber, userId) => {
    await automateProcess(match, order, whatsappNumber, userId);
};

export const handleTandFOnline = async (match, order, whatsappNumber, userId) => {
    const sessionId = SessionManager.createSession(whatsappNumber);
    
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
            const userSession = screenshotManager.sessions.get(userId) || screenshotManager.createSession(userId);

            for (const screenshot of result.screenshots) {
                if (fs.existsSync(screenshot)) {
                    const screenshotContent = fs.readFileSync(screenshot);
                    const timestamp = new Date().toISOString().replace(/[-:.]/g, "");
                    const filename = `tandf_status_${timestamp}.png`;
                    const filepath = path.join(userSession.folder, filename);

                    fs.writeFileSync(filepath, screenshotContent);
                    userSession.screenshots.add(filepath);
                    fs.unlinkSync(screenshot);
                }
            }
        } else {
            throw new Error(result.error || 'Failed to get screenshots');
        }

    } catch (error) {
        console.error("TandF automation error:", error);
    } finally {
        await screenshotManager.sendToWhatsApp(whatsappNumber, userId);
        await SessionManager.cleanupSession(sessionId);
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
    const sessionId = SessionManager.createSession(whatsappNumber);
    const session = SessionManager.getSession(sessionId);

    try {
        console.log(`Starting Wiley automation with SeleniumBase `);
        
        if (!fs.existsSync('screenshots')) {
            fs.mkdirSync('screenshots', { recursive: true });
        }

        const result = await new Promise((resolve, reject) => {
            // Use virtual environment Python
            const pythonProcess = spawn(VENV_PYTHON, [
                'handlers/wiley_handler.py',
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
        } else {
            throw new Error(result.error || 'Failed to get screenshots');
        }

    } catch (error) {
        console.error("Wiley automation error:", error);
    } finally {
        await screenshotManager.sendToWhatsApp(whatsappNumber, userId);
        await SessionManager.cleanupSession(sessionId);
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

// Main journal handler function
export const handleJournal = async (match, order, whatsappNumber, userId) => {
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
    } else if (url.includes("wiley.scienceconnect.io") || url.includes("onlinelibrary.wiley")) {
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
