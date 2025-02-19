import dotenv from 'dotenv';
import crypto from 'crypto';

dotenv.config();

export const dbConfig = {
  path: process.env.DB_PATH
};

export const cryptoConfig = {
  algorithm: process.env.ENCRYPTION_ALGORITHM,
  key: Buffer.from(process.env.ENCRYPTION_KEY, 'hex'),
  iv: Buffer.from(process.env.ENCRYPTION_IV, 'hex')
};

export const whatsappConfig = {
  phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
  token: process.env.WHATSAPP_TOKEN,
  verifyToken: process.env.VERIFY_TOKEN,
  defaultNumber: process.env.DEFAULT_WHATSAPP_NUMBER
};

export const seleniumConfig = {
  screenshotFolder: process.env.SCREENSHOT_FOLDER,
  chromeDriverPath: process.env.CHROME_DRIVER_PATH
};
