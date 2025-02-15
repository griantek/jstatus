import express from 'express';
import apiRoutes from './api.js';

const router = express.Router();

// Mount API routes
router.use('/api', apiRoutes);

// Root route
router.get('/', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Journal Status Finder API',
    version: '9.0.0'
  });
});

export default router;
