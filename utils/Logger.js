import fs from 'fs/promises';
import path from 'path';

class Logger {
    constructor() {
        this.baseLogPath = path.join(process.cwd(), 'logs');
        this.currentYearFile = null;
        this.activeRequests = new Map(); // Track active requests
        this.initLogger();
    }

    async initLogger() {
        try {
            await fs.mkdir(this.baseLogPath, { recursive: true });
            const year = new Date().getFullYear();
            this.currentYearFile = path.join(this.baseLogPath, `journal_logs_${year}.json`);
            
            // Create year file if it doesn't exist
            try {
                await fs.access(this.currentYearFile);
            } catch {
                await fs.writeFile(this.currentYearFile, '[]');
            }
            
            console.log(`Logger initialized for year ${year}`);
        } catch (error) {
            console.error('Failed to initialize logger:', error);
        }
    }

    calculateDuration(startTime, endTime) {
        return Math.round((new Date(endTime) - new Date(startTime)) / 1000);
    }

    async logUserRequest(data) {
        try {
            const year = new Date().getFullYear();
            const logFile = path.join(this.baseLogPath, `journal_logs_${year}.json`);
            
            // Initialize or get existing request entry
            let logEntry = this.activeRequests.get(data.requestId) || {
                id: data.requestId,
                timestamp: new Date().toISOString(),
                whatsappNumber: data.from,
                searchQuery: data.searchQuery,
                startTime: data.startTime,
                matchCount: data.matchCount || 0,
                journals: [],
                status: data.status
            };

            // Update existing entry with new data
            if (data.status === 'completed' || data.status === 'error') {
                logEntry.status = data.status;
                logEntry.completionTime = data.completionTime;
                logEntry.totalDuration = this.calculateDuration(logEntry.startTime, data.completionTime);
                
                // Clean up active request
                this.activeRequests.delete(data.requestId);
            } else {
                // Store active request
                this.activeRequests.set(data.requestId, logEntry);
            }

            // Read existing logs
            let logs = [];
            try {
                const existingData = await fs.readFile(logFile, 'utf8');
                logs = JSON.parse(existingData);
                
                // Update or add entry
                const existingIndex = logs.findIndex(log => log.id === data.requestId);
                if (existingIndex >= 0) {
                    logs[existingIndex] = logEntry;
                } else {
                    logs.push(logEntry);
                }
            } catch (error) {
                logs = [logEntry];
            }

            // Write updated logs
            await fs.writeFile(logFile, JSON.stringify(logs, null, 2));
            return logEntry.id;
        } catch (error) {
            console.error('Logging error:', error);
        }
    }

    async updateJournalStatus(requestId, journalData) {
        try {
            const year = new Date().getFullYear();
            const logFile = path.join(this.baseLogPath, `journal_logs_${year}.json`);

            // Get active request or from file
            let logEntry = this.activeRequests.get(requestId);
            if (!logEntry) {
                const logs = JSON.parse(await fs.readFile(logFile, 'utf8'));
                logEntry = logs.find(log => log.id === requestId);
            }

            if (logEntry) {
                // Calculate timeTaken for journal
                if (journalData.startTime && journalData.completionTime) {
                    journalData.timeTaken = this.calculateDuration(
                        journalData.startTime,
                        journalData.completionTime
                    );
                }

                const journalIndex = logEntry.journals.findIndex(j => j.url === journalData.url);
                if (journalIndex >= 0) {
                    logEntry.journals[journalIndex] = {
                        ...logEntry.journals[journalIndex],
                        ...journalData
                    };
                } else {
                    logEntry.journals.push(journalData);
                }

                // Update active request if exists
                if (this.activeRequests.has(requestId)) {
                    this.activeRequests.set(requestId, logEntry);
                }

                // Update file
                const logs = JSON.parse(await fs.readFile(logFile, 'utf8'));
                const entryIndex = logs.findIndex(log => log.id === requestId);
                if (entryIndex >= 0) {
                    logs[entryIndex] = logEntry;
                    await fs.writeFile(logFile, JSON.stringify(logs, null, 2));
                }
            }
        } catch (error) {
            console.error('Error updating journal status:', error);
        }
    }

    async getRequestLog(requestId) {
        const year = new Date().getFullYear();
        const logFile = path.join(this.baseLogPath, `journal_logs_${year}.json`);

        try {
            const logs = JSON.parse(await fs.readFile(logFile, 'utf8'));
            return logs.find(log => log.id === requestId);
        } catch (error) {
            console.error('Error reading log:', error);
            return null;
        }
    }

    // Add utility methods for log analysis
    async getYearlyStats(year = new Date().getFullYear()) {
        const logFile = path.join(this.baseLogPath, `journal_logs_${year}.json`);
        try {
            const logs = JSON.parse(await fs.readFile(logFile, 'utf8'));
            return {
                totalRequests: logs.length,
                successfulRequests: logs.filter(log => log.status === 'completed').length,
                failedRequests: logs.filter(log => log.status === 'error').length,
                averageDuration: logs.reduce((acc, log) => acc + (log.totalDuration || 0), 0) / logs.length,
                totalJournals: logs.reduce((acc, log) => acc + (log.journals?.length || 0), 0)
            };
        } catch (error) {
            console.error('Error getting yearly stats:', error);
            return null;
        }
    }

    async logFeedback(data) {
        try {
            const year = new Date().getFullYear();
            const feedbackLogFile = path.join(this.baseLogPath, `feedback_logs_${year}.json`);
            
            let feedbacks = [];
            try {
                const existingData = await fs.readFile(feedbackLogFile, 'utf8');
                feedbacks = JSON.parse(existingData);
            } catch {
                // File doesn't exist yet
            }

            const feedbackEntry = {
                timestamp: new Date().toISOString(),
                userId: data.userId,
                whatsappNumber: data.whatsappNumber,
                feedback: data.feedback,
                reprocessRequested: data.reprocessRequested || false,
                originalRequestId: data.requestId,
                messageId: data.messageId
            };

            feedbacks.push(feedbackEntry);
            await fs.writeFile(feedbackLogFile, JSON.stringify(feedbacks, null, 2));
            return feedbackEntry;
        } catch (error) {
            console.error('Error logging feedback:', error);
        }
    }
}

export const logger = new Logger();
