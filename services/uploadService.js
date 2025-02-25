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
                    // console.log(`Successfully uploaded ${fileType} screenshot`);
                    // console.log('URL generated:', publicUrl);

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
        let screenshotResult = null;
        const journalIdStr = String(journalId); // Move this to top scope
        
        try {
            const journalFolder = path.join(tempFolder, journalIdStr);

            // Clean up existing journal folder if it exists
            if (fs.existsSync(journalFolder)) {
                fs.rmSync(journalFolder, { recursive: true, force: true });
            }

            // Create fresh directories
            fs.mkdirSync(tempFolder, { recursive: true });
            fs.mkdirSync(journalFolder, { recursive: true });

            console.log(`Created fresh folder structure in: ${journalFolder}`);

            // Get journal details and execute automation
            const journalDetails = await this.getJournalDetails(journalId);
            await handleJournal({
                url: journalDetails.url,
                username: journalDetails.username,
                password: journalDetails.password
            }, 1, null, journalIdStr);

            // Add longer delay to ensure screenshots are written
            await new Promise(resolve => setTimeout(resolve, 8000));

            // Get all screenshots from the journal folder
            let screenshots = [];
            if (fs.existsSync(journalFolder)) {
                // Get all PNG files directly in the journal folder
                screenshots = fs.readdirSync(journalFolder)
                    .filter(file => file.endsWith('.png'))
                    .map(file => path.join(journalFolder, file));

                // Get all subdirectories
                const subdirs = fs.readdirSync(journalFolder, { withFileTypes: true })
                    .filter(dirent => dirent.isDirectory())
                    .map(dirent => path.join(journalFolder, dirent.name));

                // Get screenshots from each subdirectory
                for (const dir of subdirs) {
                    if (fs.existsSync(dir)) {
                        const subDirScreenshots = fs.readdirSync(dir)
                            .filter(file => file.endsWith('.png'))
                            .map(file => path.join(dir, file));
                        screenshots.push(...subDirScreenshots);
                    }
                }
            }

            if (screenshots.length === 0) {
                throw new Error('No screenshots were generated');
            }

            // Sort and process screenshots
            screenshots.sort((a, b) => fs.statSync(a).birthtimeMs - fs.statSync(b).birthtimeMs);
            console.log('Found screenshots:', screenshots);

            // Read screenshot files
            const screenshotBuffers = await Promise.all(
                screenshots.map(async filepath => {
                    console.log(`Reading file: ${filepath}`);
                    return fs.promises.readFile(filepath);
                })
            );

            // Upload screenshots
            screenshotResult = await this.uploadMultipleScreenshots(
                journalId,
                journalDetails.searchQuery,
                screenshotBuffers
            );

            return {
                success: true,
                journalId: journalDetails.journalId,
                searchQuery: journalDetails.searchQuery,
                screenshots: screenshotResult.urls,
                count: screenshotResult.count
            };

        } catch (error) {
            console.error('Automation error:', error);
            throw error;
        } finally {
            // Clean up the journal folder using journalIdStr from outer scope
            try {
                const journalFolder = path.join(tempFolder, journalIdStr);
                if (fs.existsSync(journalFolder)) {
                    fs.rmSync(journalFolder, { recursive: true, force: true });
                    console.log(`Cleaned up folder: ${journalFolder}`);
                }
            } catch (cleanupError) {
                console.error('Cleanup error:', cleanupError);
            }
        }
    }
};
