from seleniumbase import Driver
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver import ActionChains
import os
import sys
import json
import time
from PIL import Image  # Ensure Pillow is installed
import io

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
            os.makedirs("screenshots", exist_ok=True)
            timestamp = time.strftime("%Y%m%d-%H%M%S")
            screenshot_path = os.path.join("screenshots", f"wiley_{timestamp}.png")
            take_full_screenshot(driver, screenshot_path)
            return screenshot_path
        elif instruction == "GOTOURL":
            print("Navigating to Wiley submission dashboard")
            driver.get("https://wiley.atyponrex.com/submission/dashboard")
            time.sleep(5)  # Wait 5 seconds after navigation
            
        # time.sleep(1)  # Small delay after each action
        
    except Exception as e:
        print(f"Error executing {instruction}: {str(e)}")
    return None

def handle_wiley(url, username, password):
    driver = None
    try:
        driver = Driver(uc=True, headed=True, headless=True)  # Added headless=True
        driver.set_window_size(1920, 1080)
        
        # Always navigate to the Wiley Science Connect login page first
        print("Navigating to Wiley Science Connect login page")
        driver.get("https://wiley.atyponrex.com/submission/dashboard?siteName=JZO")
        time.sleep(6)

        screenshots = []
        
        try:
            with open('keys/wiley_KEYS.txt', 'r') as f:
                instructions = [line.strip() for line in f if line.strip()]
        except Exception as e:
            print(f"Error reading instructions file: {str(e)}")
            instructions = []

        # Execute each instruction
        for instruction in instructions:
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
        print(json.dumps(result))
        sys.stdout.flush()

if __name__ == "__main__":
    if len(sys.argv) != 4:
        result = {"status": "error", "error": "Invalid arguments"}
        print(json.dumps(result))
        sys.exit(1)
    
    handle_wiley(sys.argv[1], sys.argv[2], sys.argv[3])
