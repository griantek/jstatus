import { Key } from "selenium-webdriver";
import { By } from "selenium-webdriver";
import { screenshotManager } from '../services/services.js';  // Updated path

// Helper function for switching active elements
async function switchToActiveElement(driver) {
    let activeElement = await driver.switchTo().activeElement();
    let tagName = await activeElement.getTagName();
    
    while (tagName === 'iframe') {
        await driver.switchTo().frame(activeElement);
        activeElement = await driver.switchTo().activeElement();
        tagName = await activeElement.getTagName();
    }
    
    return activeElement;
}

// Editorial Manager CHKSTS handler
export async function handleEditorialManagerCHKSTS(driver, order, foundTexts, whatsappNumber, userId) {
    console.log("Starting Editorial Manager status check...");
    let found = false;
    let attempts = 0;
    const MAX_ATTEMPTS = 20;

    const textCollection = [
        "Submissions Sent Back to Author",
        "Incomplete Submissions",
        "Submissions Waiting for Author's Approval",
        "Submissions Being Processed",
        "Submissions Needing Revision",
        "Revisions Sent Back to Author",
        "Incomplete Submissions Being Revised",
        "Revisions Waiting for Author's Approval",
        "Revisions Being Processed",
        "Declined Revisions",
        "Submissions with a Decision",
        "Submissions with Production Completed",
        "Submission Transfers Waiting for Author's Approval"
    ];

    try {
        while (!found && attempts < MAX_ATTEMPTS) {
            attempts++;
            await driver.actions().sendKeys(Key.TAB).perform();
            let activeElement = await switchToActiveElement(driver);
            let text = await activeElement.getText();

            if (textCollection.includes(text) && !foundTexts.includes(text)) {
                found = true;
                foundTexts.push(text);

                try {
                    await driver.actions().keyDown(Key.CONTROL).sendKeys(Key.RETURN).keyUp(Key.CONTROL).perform();
                    const tabs = await driver.getAllWindowHandles();
                    await driver.switchTo().window(tabs[1]);
                    await driver.sleep(5000);

                    await screenshotManager.capture(driver, text, userId);

                    await driver.close();
                    await driver.switchTo().window(tabs[0]);
                    await driver.actions().sendKeys(Key.HOME).perform();
                    await driver.sleep(2000);
                    break;
                } catch (error) {
                    console.error('Error handling tab operations:', error);
                    const tabs = await driver.getAllWindowHandles();
                    await driver.switchTo().window(tabs[0]);
                }
            }
        }

        if (!found) {
            console.log("No status texts found after maximum attempts");
            return;
        }

        // Check for additional statuses
        let notFoundInCollection = false;
        attempts = 0;

        while (!notFoundInCollection && attempts < MAX_ATTEMPTS) {
            attempts++;
            await driver.actions().sendKeys(Key.TAB).perform();
            await driver.sleep(1000);

            let activeElement = await switchToActiveElement(driver);
            let text = await activeElement.getText();

            if (!text) continue;

            if (!textCollection.includes(text)) {
                notFoundInCollection = true;
            } else if (!foundTexts.includes(text)) {
                foundTexts.push(text);

                try {
                    await driver.actions().keyDown(Key.CONTROL).sendKeys(Key.RETURN).keyUp(Key.CONTROL).perform();
                    const tabs = await driver.getAllWindowHandles();
                    await driver.switchTo().window(tabs[1]);
                    await driver.sleep(5000);

                    await screenshotManager.capture(driver, text, userId);

                    await driver.close();
                    await driver.switchTo().window(tabs[0]);
                    await driver.actions().sendKeys(Key.HOME).perform();
                    await driver.sleep(2000);
                } catch (error) {
                    console.error('Error handling additional status:', error);
                }
            }
        }
    } catch (error) {
        console.error('Error in handleEditorialManagerCHKSTS:', error);
    }
}

// Manuscript Central CHKSTS handler
export async function handleManuscriptCentralCHKSTS(driver, order, foundTexts) {
    // TODO: Implement Manuscript Central CHKSTS handling
    console.log("ManuscriptCentral CHKSTS handler not implemented yet");
}

// TandF Online CHKSTS handler
export async function handleTandFOnlineCHKSTS(driver, order, foundTexts) {
    // TODO: Implement TandF Online CHKSTS handling
    console.log("TandF Online CHKSTS handler not implemented yet");
}

// Taylor Francis CHKSTS handler
export async function handleTaylorFrancisCHKSTS(driver, order, foundTexts) {
    // TODO: Implement Taylor Francis CHKSTS handling
    console.log("Taylor Francis CHKSTS handler not implemented yet");
}

// CG Scholar CHKSTS handler
export async function handleCGScholarCHKSTS(driver, order, foundTexts) {
    await driver.get("https://cgp.cgscholar.com/m/WithdrawalSubmission?init=true");
    await driver.sleep(5000);
}

// TheSciPub CHKSTS handler
export async function handleTheSciPubCHKSTS(driver, order, foundTexts, whatsappNumber) {
    for (let i = 0; i < 13; i++) {
        await driver.actions().sendKeys(Key.TAB).perform();
        await driver.sleep(1000);
        
        let activeElement = await switchToActiveElement(driver);
        let text = await activeElement.getText();

        if (i >= 2 && text.includes("(1)")) {
            await driver.actions().keyDown(Key.CONTROL).sendKeys(Key.RETURN).keyUp(Key.CONTROL).perform();
            const tabs = await driver.getAllWindowHandles();
            await driver.switchTo().window(tabs[1]);
            await driver.sleep(5000);

            console.log("Taking screenshot...");
            const screenshotFolder = `screenshots/${order}`;
            if (!fs.existsSync(screenshotFolder)) {
                fs.mkdirSync(screenshotFolder, { recursive: true });
            }
            const timestamp = new Date().toISOString().replace(/[-:.]/g, "");
            const screenshotName = `${screenshotFolder}/${text.replace(/[^a-zA-Z0-9]/g, '_')}_${timestamp}.png`;
            const image = await driver.takeScreenshot();
            fs.writeFileSync(screenshotName, "base64");

            await sendWhatsAppImage(whatsappNumber, screenshotName, text);
            fs.unlinkSync(screenshotName);

            await driver.close();
            await driver.switchTo().window(tabs[0]);
            await driver.actions().sendKeys(Key.HOME).perform();
            await driver.sleep(2000);
        }
    }
}

// Wiley CHKSTS handler
export async function handleWileyCHKSTS(driver, order, foundTexts) {
    // TODO: Implement Wiley CHKSTS handling
    console.log("Wiley CHKSTS handler not implemented yet");
}

// Periodicos CHKSTS handler
export async function handlePeriodicosCHKSTS(driver, order, foundTexts) {
    // TODO: Implement Periodicos CHKSTS handling
    console.log("Periodicos CHKSTS handler not implemented yet");
}

// TSP Submission CHKSTS handler
export async function handleTSPSubmissionCHKSTS(driver, order, foundTexts) {
    // TODO: Implement TSP Submission CHKSTS handling
    console.log("TSP Submission CHKSTS handler not implemented yet");
}

// Springer Nature CHKSTS handler
export async function handleSpringerNatureCHKSTS(driver, order, foundTexts) {
    // TODO: Implement Springer Nature CHKSTS handling
    console.log("Springer Nature CHKSTS handler not implemented yet");
}
