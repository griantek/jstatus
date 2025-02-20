from seleniumbase import Driver
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver import ActionChains
import os
import sys
import json
import time

def execute_instruction(driver, instruction, username=None, password=None):
    try:
        actions = ActionChains(driver)
        
        if instruction == "TAB":
            actions.send_keys(Keys.TAB).perform()
        elif instruction == "SPACE":
            actions.send_keys(Keys.SPACE).perform()
        elif instruction == "ENTER":
            actions.send_keys(Keys.RETURN).perform()
        elif instruction == "INPUTUSR" and username:
            actions.send_keys(username).perform()
        elif instruction == "INPUTPASS" and password:
            actions.send_keys(password).perform()
        elif instruction.startswith("SLEEP"):
            try:
                sleep_time = int(instruction.strip("{}").split("{")[1])
                time.sleep(sleep_time / 1000)  # Convert milliseconds to seconds
                print(f"Slept for {sleep_time}ms")
            except:
                time.sleep(1)  # Default 1 second if parse fails
        elif instruction == "SCRNSHT":
            os.makedirs("screenshots", exist_ok=True)  # Standardized folder name
            timestamp = time.strftime("%Y%m%d-%H%M%S")
            screenshot_path = os.path.join("screenshots", f"tandf_{timestamp}.png")
            driver.get_screenshot_as_file(screenshot_path)
            return screenshot_path
            
        # time.sleep(1)  # Small delay after each action
        
    except Exception as e:
        print(f"Error executing {instruction}: {str(e)}")
    return None

def handle_tandf(url, username, password):
    driver = None
    try:
        driver = Driver(uc=True, headed=True , headless=True)  # Create headed browser
        # print("Driver initialized")
        
        # Set window size
        driver.set_window_size(1920, 1080)
        print("Window size set")
        
        # Navigate to URL
        driver.get(url)
        # print(f"Navigated to {url}")
        time.sleep(5)  # Wait for page load

        screenshots = []
        
        # Read instructions file
        try:
            with open('keys/tandf_KEYS.txt', 'r') as f:
                instructions = [line.strip() for line in f if line.strip()]
            # print(f"Read {len(instructions)} instructions")
        except Exception as e:
            print(f"Error reading instructions file: {str(e)}")
            instructions = []

        # Execute each instruction
        for instruction in instructions:
            # print(f"Executing: {instruction}")
            screenshot = execute_instruction(driver, instruction, username, password)
            if screenshot:
                screenshots.append(screenshot)
                print(f"Screenshot saved: {screenshot}")

        result = {
            "status": "success",
            "screenshots": screenshots,
            "message": f"Completed {len(instructions)} instructions"
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
        print(json.dumps(result))  # Print final result
        sys.stdout.flush()         # Ensure output is sent

if __name__ == "__main__":
    if len(sys.argv) != 4:
        result = {"status": "error", "error": "Invalid arguments"}
        print(json.dumps(result))
        sys.exit(1)
    
    handle_tandf(sys.argv[1], sys.argv[2], sys.argv[3])
