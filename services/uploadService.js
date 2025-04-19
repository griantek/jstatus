import { supabase } from '../config/supabase.js';
import { logger } from '../utils/Logger.js';
import fs from 'fs';
import path from 'path';
import { handleJournal } from '../handlers/journalHandlers.js';
import { decrypt } from './services.js';
import { screenshotManager } from './services.js';

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
        const uploadedFiles = []; // Track which files were successfully uploaded
        
        try {
            const bucketName = 'status-screenshot';
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
                            upsert: true // This will overwrite existing files with the same name
                        });

                    console.log('Upload response:', { uploadData, uploadError });

                    if (uploadError) {
                        console.error('Upload error:', uploadError);
                        continue;
                    }

                    const publicUrl = `${process.env.SUPABASE_STORAGE_URL}/object/public/${bucketName}//${fileName}`;
                    uploadedUrls.push(publicUrl);
                    uploadedFiles.push(i); // Track which buffer indices were uploaded
                    console.log(`Successfully uploaded file ${fileName}`);

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
                totalAttempted: screenshotBuffers.length,
                uploadedFiles // Return which files were uploaded
            };

        } catch (error) {
            console.error('Upload process error:', error);
            throw error;
        }
    },

    async automateScreenshotCapture(journalId) {
        const tempFolder = 'screenshots';
        let userFolder = null;
        let screenshotResult = null;
        const journalIdStr = String(journalId);
        const localFilePaths = []; // Track local file paths for cleanup
        
        try {
            const journalFolder = path.join(tempFolder, journalIdStr);

            // Create fresh directories - but don't clean up existing folders to avoid deleting files in use
            fs.mkdirSync(tempFolder, { recursive: true });
            fs.mkdirSync(journalFolder, { recursive: true });

            console.log(`Ensuring folder structure exists: ${journalFolder}`);

            // Get journal details and execute automation
            const journalDetails = await this.getJournalDetails(journalId);
            
            // Execute the handleJournal function
            const screenshots = await handleJournal({
                url: journalDetails.url,
                username: journalDetails.username,
                password: journalDetails.password
            }, 1, null, journalIdStr);
            
            // Get the user session with the screenshots
            const userSession = screenshotManager.sessions.get(journalIdStr);
            
            if (!userSession || !userSession.screenshots || userSession.screenshots.size === 0) {
                console.log('No screenshots captured in session');
                return { success: false, message: 'No screenshots captured' };
            }
            
            console.log(`Found ${userSession.screenshots.size} screenshots in session`);
            
            // Check which screenshots actually exist at this moment 
            const screenshotBuffers = [];
            
            // Use a synchronous approach to check and immediately read each file
            for (const filepath of userSession.screenshots) {
                try {
                    console.log(`Checking file existence: ${filepath}`);
                    
                    if (fs.existsSync(filepath)) {
                        console.log(`File exists, reading content: ${filepath}`);
                        // Read the file immediately to get its content before it might be deleted
                        const buffer = fs.readFileSync(filepath);
                        screenshotBuffers.push(buffer);
                        localFilePaths.push(filepath); // Track for cleanup
                        console.log(`Successfully read file: ${filepath}`);
                    } else {
                        console.log(`File does not exist, skipping: ${filepath}`);
                    }
                } catch (error) {
                    console.error(`Error processing file ${filepath}:`, error);
                }
            }
            
            if (screenshotBuffers.length === 0) {
                console.log('No valid screenshots could be read');
                return { success: false, message: 'No valid screenshots could be read' };
            }
            
            console.log(`Successfully read ${screenshotBuffers.length} screenshot buffers`);
            
            // Upload the screenshots
            const uploadResult = await this.uploadMultipleScreenshots(
                journalId,
                journalDetails.searchQuery,
                screenshotBuffers
            );
            
            console.log(`Successfully uploaded ${uploadResult.count} screenshots`);
            
            // Clean up local files after successful upload
            console.log(`Cleaning up ${localFilePaths.length} local files after upload`);
            
            for (const filepath of localFilePaths) {
                try {
                    fs.unlinkSync(filepath);
                    console.log(`Successfully deleted file after upload: ${filepath}`);
                } catch (err) {
                    console.error(`Error deleting file ${filepath}: ${err.message}`);
                }
            }
            
            // Try to remove the directory if it's empty
            try {
                if (fs.existsSync(userSession.folder)) {
                    const remainingFiles = fs.readdirSync(userSession.folder);
                    if (remainingFiles.length === 0) {
                        fs.rmdirSync(userSession.folder);
                        console.log(`Successfully removed empty directory: ${userSession.folder}`);
                    } else {
                        console.log(`Directory not empty, skipping removal: ${userSession.folder}`);
                        console.log(`${remainingFiles.length} files remaining: ${remainingFiles.join(', ')}`);
                    }
                }
            } catch (cleanupError) {
                console.error(`Error during directory cleanup: ${cleanupError.message}`);
            }
            
            return {
                success: true,
                message: `Successfully processed and uploaded ${uploadResult.count} screenshots`,
                data: uploadResult
            };
            
        } catch (error) {
            console.error('Automation error:', error);
            throw error;
        }
    }
};
