import sqlite3 from 'sqlite3';
import { config } from '../config/config.js';
import { EncryptionService } from './encryption.js';

class DatabaseService {
  constructor() {
    this.db = new sqlite3.Database(config.app.dbPath);
  }

  async findUser(identifier) {
    return new Promise((resolve, reject) => {
      this.db.all(
        `SELECT Journal_Link as url, Username as username, Password as password 
         FROM journal_data 
         WHERE Personal_Email = ? OR Client_Name = ?`,
        [identifier, identifier],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        }
      );
    });
  }

  async processRows(rows, whatsappNumber) {
    // Copy processRows implementation from app copy.js
  }
}

export default new DatabaseService();
