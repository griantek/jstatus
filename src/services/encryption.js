import crypto from 'crypto';
import { config } from '../config/config.js';

export class EncryptionService {
  static decrypt(text) {
    try {
      if (!text) return '';
      
      const encryptedBytes = Buffer.from(text, 'hex');
      const decipher = crypto.createDecipheriv(
        config.encryption.algorithm,
        config.encryption.key,
        config.encryption.iv
      );
      
      decipher.setAutoPadding(false);
      
      try {
        let decrypted = decipher.update(encryptedBytes);
        decrypted = Buffer.concat([decrypted, decipher.final()]);
        
        // Remove space padding
        while (decrypted.length > 0 && decrypted[decrypted.length - 1] === 32) {
          decrypted = decrypted.slice(0, -1);
        }
        
        return decrypted.toString('utf8');
      } catch (cryptoError) {
        // Fallback to auto padding
        const decipherAuto = crypto.createDecipheriv(
          config.encryption.algorithm,
          config.encryption.key,
          config.encryption.iv
        );
        let decrypted = decipherAuto.update(encryptedBytes);
        decrypted = Buffer.concat([decrypted, decipherAuto.final()]);
        return decrypted.toString('utf8').trim();
      }
    } catch (error) {
      console.error('Decryption error:', error);
      return text;
    }
  }
}
