import { processRows, handleScreenshotRequest } from '../services/services.js';
import { uploadService } from '../services/uploadService.js';
import { supabase } from '../config/supabase.js';

export const captureController = {
    // Handle capture requests
    captureRequest: async (req, res) => {
        try {
            const { username } = req.body;
            if (!username) {
                return res.status(400).json({
                    error: "Missing required parameter. Please provide username"
                });
            }

            // Query Supabase
            let { data: rows, error } = await supabase
                .from('journal_data')
                .select('journal_link as url, username, password')
                .eq('personal_email', username);

            if (error) throw error;

            if (!rows || rows.length === 0) {
                // Try Client_Name if no email match
                const { data: clientRows, error: clientError } = await supabase
                    .from('journal_data')
                    .select('journal_link as url, username, password')
                    .eq('client_name', username);

                if (clientError) throw clientError;
                rows = clientRows;
            }

            await processRows(rows, res);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    },
    
    // Check status
    checkStatus: async (req, res) => {
        try {
            const { username, phone_number } = req.body;
            if (!username || !phone_number) {
                return res.status(400).json({
                    error: "Missing parameters",
                    message: "Both username and phone_number are required"
                });
            }

            await handleScreenshotRequest(username, phone_number);
            res.status(200).json({
                status: "success",
                message: "Status check initiated",
                details: {
                    username,
                    phone: phone_number,
                    timestamp: new Date().toISOString()
                }
            });
        } catch (error) {
            res.status(500).json({
                error: 'Status check failed',
                message: error.message
            });
        }
    },
    
    // Upload status
    uploadStatus: async (req, res) => {
        try {
            const { journalId } = req.body;

            if (!journalId) {
                return res.status(400).json({
                    error: 'Missing required parameter',
                    message: 'journalId is required'
                });
            }

            // Start the automated process
            const result = await uploadService.automateScreenshotCapture(journalId);

            res.status(200).json({
                status: 'success',
                message: 'Screenshot captured and uploaded successfully',
                data: result
            });

        } catch (error) {
            console.error('Upload status error:', error);
            res.status(500).json({
                error: 'Process failed',
                message: error.message
            });
        }
    }
};
