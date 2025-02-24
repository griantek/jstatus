# Editorial Manager Automation

This application automates interactions with various academic journal submission systems using Selenium WebDriver. It reads instructions from KEYS.txt files and performs actions such as logging in, navigating through the system, and taking screenshots.

## Features

### User Authentication
- Supports user lookup by both Username and Personal_Email in the database
- Credentials stored in an encrypted SQLite database
- Uses AES-256-CBC encryption for secure storage

### Supported Journal Systems
- Editorial Manager
- Manuscript Central
- Taylor & Francis Online
- Taylor Francis
- CG Scholar
- The SciPub
- Wiley
- Periodicos
- TSP Submission
- Springer Nature

### Automation Features
- **Automated Login**: Securely logs into journal systems
- **Status Checking**: Automatically checks submission statuses
- **Screenshot Capture**: Takes screenshots of relevant pages
- **WhatsApp Integration**: Sends status updates via WhatsApp

### Instruction Set
The app reads and executes instructions from KEYS.txt files:
- `TAB`: Press the TAB key
- `SPACE`: Press the SPACE key
- `ESC`: Press the ESC key
- `ENTER`: Press the ENTER key
- `FIND`: Open find dialog (CTRL+F)
- `PASTE`: Paste clipboard content
- `SLEEP <ms>`: Pause execution
- `INPUTUSR`: Input username
- `INPUTPASS`: Input password
- `SCRNSHT`: Take screenshot
- `INPUT-<text>`: Input specific text
- `CHKSTS`: Check submission status

## Status Checking (CHKSTS)
The CHKSTS instruction performs the following:

1. **Status Detection**: Searches for predefined status texts
2. **Screenshot Capture**: Takes screenshots of relevant pages
3. **WhatsApp Notification**: Sends status updates via WhatsApp
4. **Multi-Tab Handling**: Opens status pages in new tabs
5. **Cleanup**: Automatically closes tabs and deletes temporary files

## Database Structure
The SQLite database contains:
- Journal_Link: Encrypted journal URL
- Username: Encrypted username
- Password: Encrypted password
- Personal_Email: Alternative encrypted identifier

## WhatsApp Integration
- Automatic status notifications
- Screenshot sharing
- Error notifications
- Webhook support for user requests


# INSTALLATION

run this before starting
```
python3 -m venv .venv
source .venv/bin/activate
python3 -m pip install -r requirements.txt
```