import express from 'express';
import {
  handleWebhookGet,
  handleWebhookPost,
  handleCapture,
  handleTestDecrypt,
  handleCheckStatus,
  handleCryptoInfo,
  handleHealthCheck
} from './controllers/mainController.js';
import { validateWhatsAppToken, validateRequestBody, validateWebhook } from './middlewares/authMiddleware.js';

const router = express.Router();

// WhatsApp webhook routes
router.get('/webhook', handleWebhookGet);
router.post('/webhook', validateWebhook, handleWebhookPost);

// Status check routes
router.post('/capture', validateRequestBody, handleCapture);
router.post('/check-status', validateRequestBody, handleCheckStatus);

// Utility routes
router.post('/test-decrypt', handleTestDecrypt);
router.get('/crypto-info', handleCryptoInfo);
router.get('/', handleHealthCheck);

export default router;
