import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

export const config = {
  whatsapp: {
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
    token: process.env.WHATSAPP_TOKEN,
    verifyToken: process.env.VERIFY_TOKEN
  },
  encryption: {
    algorithm: process.env.ENCRYPTION_ALGORITHM,
    key: Buffer.from(process.env.ENCRYPTION_KEY, 'hex'),
    iv: Buffer.from(process.env.ENCRYPTION_IV, 'hex')
  },
  app: {
    port: process.env.PORT || 8004,
    screenshotFolder: process.env.SCREENSHOT_FOLDER,
    dbPath: process.env.DB_PATH,
    chromeDriverPath: process.env.CHROME_DRIVER_PATH
  }
};
