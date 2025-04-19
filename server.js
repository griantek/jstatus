import express from "express";
import dotenv from "dotenv";
import { logger } from './utils/Logger.js';
import { setupRoutes } from './routes/routes.js';
import { initializeServices, screenshotManager } from './services/services.js';

// Load environment variables
dotenv.config();

// Log environment status
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

// Middleware
app.use(express.json());

// Initialize core services
const services = initializeServices();

// Initialize screenshot manager
await screenshotManager.init();

// Setup routes
setupRoutes(app, services);

// Cleanup handlers for graceful shutdown
process.on('exit', () => {
    console.log('Server shutting down, performing cleanup...');
    // Just clean up on exit - no need for periodic cleaning
});

process.on('SIGINT', () => {
    console.log('Received SIGINT, performing cleanup before exit...');
    process.exit();
});

// Start the Express server
app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});
