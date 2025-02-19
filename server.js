import express from 'express';
import routes from './routes.js';
import { initializeDatabase, dbService } from './services/dbService.js';
import { screenshotManager } from './services/screenshotManager.js';
import { logEnvironmentVariables, cleanupOldMessages } from './utils/logger.js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Initialize express app
const app = express();
const port = process.env.PORT || 8004;

// Middleware
app.use(express.json());

// Log environment variables
logEnvironmentVariables();

// Initialize services
await initializeDatabase();
await screenshotManager.init();

// Register routes
app.use('/', routes);

// Add session cleanup on intervals
const cleanupSessions = async () => {
  try {
    await screenshotManager.clearAllScreenshots();
    console.log('Regular session cleanup completed');
  } catch (error) {
    console.error('Session cleanup error:', error);
  }
};

// Run cleanup every 15 minutes
setInterval(cleanupSessions, 15 * 60 * 1000);

// Add missing processedMessages cleanup
setInterval(cleanupOldMessages, 15 * 60 * 1000);

// Add more robust cleanup handlers
const gracefulShutdown = async (signal) => {
  console.log(`${signal} received. Starting graceful shutdown...`);
  
  try {
    await screenshotManager.clearAllScreenshots();
    await dbService.closeDatabase();
    console.log('Cleanup completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('Error during shutdown:', error);
    process.exit(1);
  }
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGUSR2', () => gracefulShutdown('SIGUSR2')); // For nodemon restarts

// Cleanup handlers
process.on('exit', () => {
  screenshotManager.clearAllScreenshots();
});

process.on('SIGINT', () => {
  screenshotManager.clearAllScreenshots();
  process.exit();
});

// Start server
app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
