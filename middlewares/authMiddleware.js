import { whatsappConfig } from '../config/dbConfig.js';
import { SessionManager } from '../services/seleniumService.js';
import { systemLogger } from '../utils/logger.js';

export const validateWhatsAppToken = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Missing or invalid authorization header'
      });
    }

    const token = authHeader.split(' ')[1];
    if (token !== whatsappConfig.token) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Invalid WhatsApp token'
      });
    }

    // Add token to request for use in downstream handlers
    req.whatsappToken = token;
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    res.status(500).json({
      error: 'Authentication failed',
      message: 'Internal server error during authentication'
    });
  }
};

export const validateRequestBody = (req, res, next) => {
  try {
    const { username, phone_number } = req.body;

    const errors = [];
    
    if (!username) {
      errors.push('username is required');
    } else if (typeof username !== 'string') {
      errors.push('username must be a string');
    } else if (username.length < 3) {
      errors.push('username must be at least 3 characters long');
    }

    // If phone_number is present, validate it
    if (phone_number !== undefined) {
      if (typeof phone_number !== 'string') {
        errors.push('phone_number must be a string');
      } else if (!/^\d{10,15}$/.test(phone_number)) {
        errors.push('phone_number must be between 10-15 digits');
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors
      });
    }

    next();
  } catch (error) {
    console.error('Validation middleware error:', error);
    res.status(500).json({
      error: 'Validation failed',
      message: 'Internal server error during validation'
    });
  }
};

export const validateWebhook = (req, res, next) => {
  try {
    // Validate webhook request structure
    const entry = req.body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const messages = value?.messages?.[0];

    if (!entry || !changes || !value || !messages) {
      return res.status(400).json({
        error: 'Invalid webhook payload',
        message: 'Missing required webhook structure'
      });
    }

    // Validate message type
    if (messages.type !== 'text') {
      return res.status(400).json({
        error: 'Invalid message type',
        message: 'Only text messages are supported'
      });
    }

    // Validate message content
    const messageText = messages.text?.body?.trim();
    if (!messageText) {
      return res.status(400).json({
        error: 'Invalid message content',
        message: 'Message body cannot be empty'
      });
    }

    next();
  } catch (error) {
    console.error('Webhook validation error:', error);
    res.status(500).json({
      error: 'Webhook validation failed',
      message: 'Internal server error during webhook validation'
    });
  }
};

export const rateLimiter = (() => {
  const requests = new Map();
  const WINDOW_MS = 60000; // 1 minute
  const MAX_REQUESTS = 10; // Maximum requests per minute per user

  return (req, res, next) => {
    try {
      const userId = req.body.username || req.query.username || 'anonymous';
      const now = Date.now();
      
      // Clean up old entries
      if (requests.has(userId)) {
        const userRequests = requests.get(userId).filter(time => 
          now - time < WINDOW_MS
        );
        requests.set(userId, userRequests);
      }

      // Get current requests for user
      const userRequests = requests.get(userId) || [];
      
      if (userRequests.length >= MAX_REQUESTS) {
        return res.status(429).json({
          error: 'Too Many Requests',
          message: 'Please wait before making more requests',
          retryAfter: Math.ceil((WINDOW_MS - (now - userRequests[0])) / 1000)
        });
      }

      // Add current request
      userRequests.push(now);
      requests.set(userId, userRequests);

      next();
    } catch (error) {
      console.error('Rate limiter error:', error);
      next(); // Continue on error to prevent blocking legitimate requests
    }
  };
})();

// Add session validation middleware
export const validateSession = async (req, res, next) => {
  const sessionId = req.headers['x-session-id'];
  if (!sessionId) {
    return res.status(400).json({
      error: 'Missing session ID',
      message: 'Session ID is required'
    });
  }

  const session = await SessionManager.getSession(sessionId);
  if (!session) {
    return res.status(404).json({
      error: 'Invalid session',
      message: 'Session not found or expired'
    });
  }

  req.session = session;
  next();
};

// Add error boundary middleware
export const errorBoundary = (err, req, res, next) => {
  console.error('Unhandled error:', err);
  systemLogger.logSystemError('middleware', err);

  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'An unexpected error occurred'
  });
};
