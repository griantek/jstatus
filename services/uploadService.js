import { supabase } from '../config/supabase.js';
import { logger } from '../utils/Logger.js';
import fs from 'fs';
import path from 'path';
import { handleJournal } from '../handlers/journalHandlers.js';
import { decrypt } from './services.js';

export const uploadService = {
    async uploadScreenshotAndUpdateStatus(journalId, clientEmail, screenshotBuffer) {
        try {
            if (!journalId || !clientEmail || !screenshotBuffer) {
                throw new Error('Missing required parameters');
            }

            // Generate filename (sanitize email for safe filename)
            const fileName = `${journalId}_${clientEmail.replace(/[@.]/g, '_')}.png`;
            const filePath = `status_screenshots/${fileName}`;

            // Upload screenshot to Supabase Storage
            const { data: uploadData, error: uploadError } = await supabase
                .storage
                .from(process.env.SUPABASE_BUCKET)
                .upload(filePath, screenshotBuffer, {
                    contentType: 'image/png',
                    upsert: true
                });

            if (uploadError) {
                throw new Error(`Upload failed: ${uploadError.message}`);
            }

            // Get public URL for the uploaded file
            const { data: publicUrlData } = supabase
                .storage
                .from(process.env.SUPABASE_BUCKET)
                .getPublicUrl(filePath);

            if (!publicUrlData?.publicUrl) {
                throw new Error('Failed to generate public URL');
            }

            // Update journal_data table with the new status_link
            const { data: updateData, error: updateError } = await supabase
                .from('journal_data')
                .update({ 
                    status_link: publicUrlData.publicUrl,
                    updated_at: new Date().toISOString()
                })
                .eq('id', journalId);

            if (updateError) {
                throw new Error(`Database update failed: ${updateError.message}`);
            }

            // Log success
            await logger.logUpload({
                journalId,
                clientEmail,
                status: 'success',
                url: publicUrlData.publicUrl
            });

            return {
                success: true,
                url: publicUrlData.publicUrl,
                fileName
            };

        } catch (error) {
            // Log error
            await logger.logUpload({
                journalId,
                clientEmail,
                status: 'error',
                error: error.message
            });

            throw error;
        }
    },

    async getJournalDetails(journalId) {
        try {
            const { data: journalData, error } = await supabase
                .from('journal_data')
                .select('id, personal_email, client_name, journal_link, username, password')
                .eq('id', journalId)
                .single();

            if (error) throw new Error(`Database query failed: ${error.message}`);
            if (!journalData) throw new Error('No journal found with provided ID');

            // Decrypt sensitive data
            const decryptedData = {
                journalId: journalData.id,
                searchQuery: journalData.personal_email || journalData.client_name,
                url: decrypt(journalData.journal_link),
                username: decrypt(journalData.username),
                password: decrypt(journalData.password)
            };

            // Validate decrypted data
            if (!decryptedData.url || !decryptedData.username || !decryptedData.password) {
                throw new Error('Failed to decrypt journal credentials');
            }

            return decryptedData;
        } catch (error) {
            console.error('Error fetching journal details:', error);
            throw error;
        }
    },

    async uploadMultipleScreenshots(journalId, clientEmail, screenshotBuffers) {
        const uploadedUrls = [];
        try {
            const bucketName = 'status_screenshot';
            const isMultipleScreenshots = screenshotBuffers.length > 1;

            // Process each screenshot buffer
            for (let i = 0; i < screenshotBuffers.length; i++) {
                const fileType = isMultipleScreenshots ? `_${i + 1}` : '';
                const fileName = `${journalId}_${clientEmail.replace(/[@.]/g, '_')}${fileType}.png`;

                console.log(`Processing screenshot ${i + 1} of ${screenshotBuffers.length}: ${fileName}`);

                try {
                    const { data: uploadData, error: uploadError } = await supabase
                        .storage
                        .from(bucketName)
                        .upload(fileName, screenshotBuffers[i], {
                            contentType: 'image/png',
                            cacheControl: '3600',
                            upsert: true
                        });

                    console.log('Upload response:', { uploadData, uploadError });

                    if (uploadError) {
                        console.error('Upload error:', uploadError);
                        continue;
                    }

                    const publicUrl = `${process.env.SUPABASE_STORAGE_URL}/object/public/${bucketName}//${fileName}`;
                    uploadedUrls.push(publicUrl);
                    console.log(`Successfully uploaded ${fileType} screenshot`);
                    console.log('URL generated:', publicUrl);

                    await new Promise(resolve => setTimeout(resolve, 1000));
                } catch (error) {
                    console.error(`Error processing screenshot ${i + 1}:`, error);
                }
            }

            if (uploadedUrls.length === 0) {
                throw new Error('Failed to upload any screenshots');
            }

            // Select the appropriate URL to update in the database
            let statusLinkUrl;
            if (uploadedUrls.length > 1) {
                // If multiple screenshots, use the one with _2 suffix
                statusLinkUrl = uploadedUrls.find(url => url.includes('_2.png'));
            }
            // If no _2 suffix found or only one screenshot, use the first URL
            if (!statusLinkUrl) {
                statusLinkUrl = uploadedUrls[0];
            }

            // Update database with selected URL
            const { error: updateError } = await supabase
                .from('journal_data')
                .update({ 
                    status_link: statusLinkUrl,
                    updated_at: new Date().toISOString()
                })
                .eq('id', journalId);

            if (updateError) {
                console.error('Database update error:', updateError);
            }

            return {
                success: true,
                url: statusLinkUrl, // Return only the URL that was used for the update
                count: uploadedUrls.length,
                totalAttempted: screenshotBuffers.length
            };

        } catch (error) {
            console.error('Upload process error:', error);
            throw error;
        }
    },

    async automateScreenshotCapture(journalId) {
        const tempFolder = 'screenshots';
        let userFolder = null;
        
        try {
            // Clean up any existing folder first
            const journalFolder = path.join(tempFolder, journalId);
            if (fs.existsSync(journalFolder)) {
                fs.rmSync(journalFolder, { recursive: true, force: true });
                console.log(`Cleaned up existing folder: ${journalFolder}`);
            }

            // Create base screenshot directory
            if (!fs.existsSync(tempFolder)) {
                fs.mkdirSync(tempFolder, { recursive: true });
                console.log(`Created base folder: ${tempFolder}`);
            }

            // Create fresh journal-specific folder
            fs.mkdirSync(journalFolder, { recursive: true });
            console.log(`Created journal folder: ${journalFolder}`);

            const journalDetails = await this.getJournalDetails(journalId);
            const match = {
                url: journalDetails.url,
                username: journalDetails.username,
                password: journalDetails.password
            };

            // Execute journal automation
            await handleJournal(match, 1, null, journalId);

            // Wait a moment for files to be written
            await new Promise(resolve => setTimeout(resolve, 2000));

            // Find all subdirectories in the journal folder
            const folders = fs.readdirSync(journalFolder, { withFileTypes: true })
                .filter(dirent => dirent.isDirectory())
                .map(dirent => dirent.name);

            if (folders.length === 0) {
                throw new Error('No screenshot folder found after automation');
            }

            // Use the most recent folder
            userFolder = path.join(journalFolder, folders[0]);
            console.log('Looking for screenshots in folder:', userFolder);

            // Verify the folder exists before reading
            if (!fs.existsSync(userFolder)) {
                throw new Error(`Expected folder not found: ${userFolder}`);
            }

            // Get all screenshots
            const screenshots = fs.readdirSync(userFolder)
                .filter(file => file.endsWith('.png'))
                .map(file => path.join(userFolder, file))
                .sort((a, b) => fs.statSync(a).mtime.getTime() - fs.statSync(b).mtime.getTime());

            console.log('Found screenshots:', screenshots);

            if (!screenshots.length) {
                throw new Error('No screenshots were generated');
            }

            // Read screenshot files
            const screenshotBuffers = await Promise.all(
                screenshots.map(async filepath => {
                    console.log(`Reading file: ${filepath}`);
                    return fs.promises.readFile(filepath);
                })
            );

            // Upload screenshots
            const result = await this.uploadMultipleScreenshots(
                journalId,
                journalDetails.searchQuery,
                screenshotBuffers
            );

            // Clean up all folders
            if (fs.existsSync(journalFolder)) {
                fs.rmSync(journalFolder, { recursive: true, force: true });
                console.log(`Final cleanup of folder: ${journalFolder}`);
            }

            return {
                success: true,
                journalId: journalDetails.journalId,
                searchQuery: journalDetails.searchQuery,
                screenshots: result.urls,
                count: result.count
            };

        } catch (error) {
            console.error('Automation error:', error);
            
            // Ensure cleanup happens even on error
            try {
                const journalFolder = path.join(tempFolder, journalId);
                if (fs.existsSync(journalFolder)) {
                    fs.rmSync(journalFolder, { recursive: true, force: true });
                    console.log(`Cleaned up on error: ${journalFolder}`);
                }
            } catch (cleanupError) {
                console.error('Cleanup error:', cleanupError);
            }
            
            throw error;
        }
    }
};
