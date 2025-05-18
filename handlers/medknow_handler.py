from seleniumbase import Driver
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver import ActionChains
import os
import sys
import json
import time

def take_full_screenshot(driver, filepath):
    """Take full page screenshot with multiple fallback methods"""
    try:
        # Method 1: Get page dimensions
        total_height = driver.execute_script("return Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);")
        total_width = driver.execute_script("return Math.max(document.body.scrollWidth, document.documentElement.scrollWidth);")
        
        if total_height == 0:  # If height is 0, use viewport height
            total_height = driver.execute_script("return window.innerHeight")
        if total_width == 0:  # If width is 0, use viewport width
            total_width = driver.execute_script("return window.innerWidth")
        
        # Ensure minimum dimensions
        total_height = max(total_height, 1080)
        total_width = max(total_width, 1920)
        
        # Set window size
        driver.set_window_size(total_width, total_height)
        time.sleep(2)  # Wait for resize
        
        # Try different screenshot methods
        try:
            # Try body screenshot
            body = driver.find_element(By.TAG_NAME, 'body')
            body.screenshot(filepath)
        except Exception as e:
            print(f"Body screenshot failed, trying full page: {e}")
            driver.save_screenshot(filepath)
            
    except Exception as e:
        print(f"Screenshot error: {e}")
        # Final fallback: basic screenshot
        driver.get_screenshot_as_file(filepath)

def execute_instruction(driver, instruction, username=None, password=None, user_session_dir=None):
    try:
        actions = ActionChains(driver)
        
        if instruction == "TAB":
            actions.send_keys(Keys.TAB).perform()
            driver.sleep(1)  # Wait for page load
        elif instruction == "SPACE":
            actions.send_keys(Keys.SPACE).perform()
        elif instruction == "ENTER":
            actions.send_keys(Keys.RETURN).perform()
        elif instruction == "UP":
            actions.send_keys(Keys.ARROW_UP).perform()
        elif instruction == "DOWN":
            actions.send_keys(Keys.ARROW_DOWN).perform()
        elif instruction == "LEFT":
            actions.send_keys(Keys.ARROW_LEFT).perform()
        elif instruction == "RIGHT":
            actions.send_keys(Keys.ARROW_RIGHT).perform()
        elif instruction == "INPUTUSR" and username:
            actions.send_keys(username).perform()
        elif instruction == "INPUTPASS" and password:
            actions.send_keys(password).perform()
        elif instruction.startswith("SLEEP"):
            try:
                # Extract the number part directly from SLEEP-10000
                sleep_time = int(instruction.strip("{}").split("{")[1])
                sleep_seconds = sleep_time / 1000  # Convert milliseconds to seconds
                print(f"Sleeping for {sleep_seconds} seconds ({sleep_time}ms)")
                time.sleep(sleep_seconds)
            except Exception as e:
                print(f"Error parsing sleep time, using default: {e}")
                time.sleep(1)  # Default 1 second if parse fails
        elif instruction == "SCRNSHT":
            timestamp = time.strftime("%Y%m%d-%H%M%S")
            
            if user_session_dir and os.path.isdir(user_session_dir):
                # Save directly to the user session directory if provided
                screenshot_path = os.path.join(user_session_dir, f"medknow_status_{timestamp}.png")
                print(f"Saving screenshot directly to user session: {screenshot_path}")
            else:
                # Fallback to regular screenshots directory
                os.makedirs("screenshots", exist_ok=True)
                screenshot_path = os.path.join("screenshots", f"medknow_{timestamp}.png")
                print(f"Saving screenshot to default location: {screenshot_path}")
                
            take_full_screenshot(driver, screenshot_path)
            print(f"Screenshot taken: {screenshot_path}")
            return screenshot_path
        elif instruction == "GOTOURL":
            print("Navigating to Medknow dashboard")
            driver.get("https://review.jow.medknow.com/jow/author/dashboard")
            time.sleep(5)  # Wait 5 seconds after navigation
            
    except Exception as e:
        print(f"Error executing {instruction}: {str(e)}")
    return None

def handle_medknow(url, username, password):
    driver = None
    user_session_dir = None
    
    # Check if user session directory is provided as 4th argument
    if len(sys.argv) > 4:
        user_session_dir = sys.argv[4]
        if user_session_dir:
            print(f"User session directory provided: {user_session_dir}")
            if not os.path.isdir(user_session_dir):
                try:
                    os.makedirs(user_session_dir, exist_ok=True)
                    print(f"Created user session directory: {user_session_dir}")
                except Exception as e:
                    print(f"Failed to create user session directory: {e}")
                    user_session_dir = None
    
    try:
        # Use headless mode for consistency with other handlers
        driver = Driver(uc=True, headed=True, headless=True)
        driver.set_window_size(1920, 1080)
        print("Window size set")
        
        # Get absolute path to keys file
        keys_file = os.path.join(os.getcwd(), 'keys', 'medknow_KEYS.txt')
        print(f"Looking for keys file at: {keys_file}")

        if not os.path.exists(keys_file):
            print(f"Keys file not found at {keys_file}")
            raise FileNotFoundError(f"Keys file not found at {keys_file}")

        # Navigate to URL with delay
        driver.get(url)
        driver.sleep(5)  # Wait for page load

        screenshots = []
        
        # Read instructions file with error handling
        try:
            with open(keys_file, 'r') as f:
                instructions = [line.strip() for line in f if line.strip()]
            print(f"Successfully read {len(instructions)} instructions")
        except Exception as e:
            print(f"Error reading instructions file: {str(e)}")
            instructions = []

        # Execute each instruction with logging
        for idx, instruction in enumerate(instructions):
            print(f"Executing instruction {idx + 1}/{len(instructions)}: {instruction}")
            screenshot = execute_instruction(driver, instruction, username, password, user_session_dir)
            if screenshot:
                screenshots.append(screenshot)
                print(f"Screenshot saved: {screenshot}")

        # Take a final screenshot after all instructions complete
        final_timestamp = time.strftime("%Y%m%d-%H%M%S")
        
        if user_session_dir and os.path.isdir(user_session_dir):
            # Save directly to user session directory
            final_screenshot_path = os.path.join(user_session_dir, f"medknow_status_final_{final_timestamp}.png")
        else:
            # Fallback location
            os.makedirs("screenshots", exist_ok=True)
            final_screenshot_path = os.path.join("screenshots", f"medknow_final_{final_timestamp}.png")
            
        take_full_screenshot(driver, final_screenshot_path)
        screenshots.append(final_screenshot_path)
        print(f"Final screenshot saved: {final_screenshot_path}")

        result = {
            "status": "success",
            "screenshots": screenshots,
            "message": f"Completed {len(instructions)} instructions",
            "debug": f"Read {len(instructions)} instructions from {keys_file}"
        }
        
    except Exception as e:
        print(f"Error during execution: {str(e)}")
        result = {
            "status": "error",
            "error": str(e)
        }
    
    finally:
        if driver:
            driver.quit()
        print(json.dumps(result))
        sys.stdout.flush()

if __name__ == "__main__":
    if len(sys.argv) < 4:
        result = {"status": "error", "error": "Invalid arguments"}
        print(json.dumps(result))
        sys.exit(1)
    
    handle_medknow(sys.argv[1], sys.argv[2], sys.argv[3])
