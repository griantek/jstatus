import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/Logger.js';
import { handleScreenshotRequest, processRows } from '../services/services.js';
import { uploadService } from '../services/uploadService.js';
import { supabase } from '../config/supabase.js';
import { mainController } from '../controllers/mainController.js';
import { webhookController } from '../controllers/webhookController.js';
import { captureController } from '../controllers/captureController.js';

export function setupRoutes(app, services) {
    // Health check route
    app.get('/', (req, res) => mainController.healthCheck(req, res));

    // WhatsApp webhook verification
    app.get('/webhook', (req, res) => webhookController.verifyWebhook(req, res));

    // WhatsApp webhook
    app.post('/webhook', (req, res) => webhookController.handleWebhook(req, res, services));

    // Capture route
    app.post("/capture", (req, res) => captureController.captureRequest(req, res));

    // Test decrypt route
    app.post("/test-decrypt", (req, res) => mainController.testDecrypt(req, res, services));

    // Status check route
    app.post("/check-status", (req, res) => captureController.checkStatus(req, res));

    // Update upload-status route
    app.post('/upload-status', (req, res) => captureController.uploadStatus(req, res));

    // Crypto info route
    app.get('/crypto-info', (req, res) => mainController.cryptoInfo(req, res, services));
}
