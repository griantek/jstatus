import sqlite3 from 'sqlite3';
import { dbConfig, cryptoConfig } from '../config/dbConfig.js';
import { decrypt } from '../utils/logger.js';

let db;

export const initializeDatabase = () => {
  db = new sqlite3.Database(dbConfig.path, (err) => {
    if (err) {
      console.error('Error opening database:', err);
    } else {
      console.log('Database connected.');
    }
  });
};

const closeDatabase = () => {
  if (db) {
    db.close((err) => {
      if (err) {
        console.error('Error closing database:', err);
      } else {
        console.log('Database closed.');
      }
    });
  }
};

const cleanupDatabase = () => {
  // Implement cleanup logic if needed
};

export const dbService = {
  closeDatabase,
  cleanupDatabase
};

export const findUserByIdentifier = async (identifier) => {
  return new Promise((resolve, reject) => {
    // First try Personal_Email
    db.all(
      "SELECT Journal_Link as url, Username as username, Password as password FROM journal_data WHERE Personal_Email = ?",
      [identifier],
      (err, emailRows) => {
        if (err) {
          reject(err);
          return;
        }

        if (emailRows && emailRows.length > 0) {
          resolve(emailRows);
          return;
        }

        // Then try Client_Name
        db.all(
          "SELECT Journal_Link as url, Username as username, Password as password FROM journal_data WHERE Client_Name = ?",
          [identifier],
          (err, clientRows) => {
            if (err) reject(err);
            else resolve(clientRows);
          }
        );
      }
    );
  });
};

export const findUserByClientName = async (clientName) => {
  return new Promise((resolve, reject) => {
    db.all(
      "SELECT Journal_Link as url, Username as username, Password as password FROM journal_data WHERE Client_Name = ?",
      [clientName],
      (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      }
    );
  });
};

export const findUserByEmail = async (email) => {
  return new Promise((resolve, reject) => {
    db.all(
      "SELECT Journal_Link as url, Username as username, Password as password FROM journal_data WHERE Personal_Email = ?",
      [email],
      (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      }
    );
  });
};

export const runInTransaction = async (callback) => {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run('BEGIN TRANSACTION');
      try {
        const result = callback();
        db.run('COMMIT');
        resolve(result);
      } catch (error) {
        db.run('ROLLBACK');
        reject(error);
      }
    });
  });
};

// Add event listeners for cleanup
process.on('SIGINT', async () => {
  try {
    await closeDatabase();
    process.exit(0);
  } catch (error) {
    console.error('Error closing database:', error);
    process.exit(1);
  }
});

process.on('exit', async () => {
  try {
    await closeDatabase();
  } catch (error) {
    console.error('Error closing database on exit:', error);
  }
});

// Add cleanup handlers
process.on('SIGINT', cleanupDatabase);
process.on('SIGTERM', cleanupDatabase);
process.on('exit', cleanupDatabase);
