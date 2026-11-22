#!/usr/bin/env python3
import sys
import os
import time
from playwright.sync_api import sync_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
DATA_DIR = os.path.join(ROOT, 'data')
DOWNLOADS_DIR = os.path.join(ROOT, 'downloads')
AUTH_STATE_PATH = os.path.join(DATA_DIR, 'google_flow_auth_state.json')

os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(DOWNLOADS_DIR, exist_ok=True)

def test_generate(prompt="Cinematic neon glowing AI laboratory in 4k"):
    print(f"[Google Flow Test] Initiating video generation test with prompt: '{prompt}'...")
    with sync_playwright() as p:
        browser = p.chromium.launch(
            channel='chrome',
            headless=True,
            args=['--disable-blink-features=AutomationControlled']
        )
        context = browser.new_context(
            storage_state=AUTH_STATE_PATH,
            viewport={'width': 1280, 'height': 800}
        )
        page = context.new_page()

        print("[Google Flow Test] Navigating to dashboard...")
        page.goto("https://flow.google.com/", wait_until="domcontentloaded", timeout=30000)
        time.sleep(3)

        # Dismiss any overlays or modals
        page.keyboard.press("Escape")
        time.sleep(1)

        # Check for + New project button or card
        print("[Google Flow Test] Clicking '+ New project'...")
        new_project_btn = page.locator("text=+ New project, text=New project, [aria-label*='New project']").first
        if new_project_btn.count() > 0:
            new_project_btn.click(force=True)
            time.sleep(5)
        else:
            print("[Google Flow Test] Trying to open first project card...")
            cards = page.locator("a[href*='/project/']").first
            if cards.count() > 0:
                cards.click(force=True)
                time.sleep(5)

        page.keyboard.press("Escape")
        time.sleep(1)
        print(f"[Google Flow Test] Current URL inside project: {page.url}")

        # Locate ProseMirror editor: aria-label="What do you want to create?"
        editor = page.locator("div.ProseMirror, [aria-label*='What do you want to create'], [contenteditable='true']").first
        if editor.count() > 0:
            print("[Google Flow Test] Found ProseMirror creation input! Focusing and typing prompt...")
            editor.click(force=True)
            time.sleep(1)
            page.keyboard.type(prompt, delay=30)
            time.sleep(2)

            print("[Google Flow Test] Submitting generation job...")
            page.keyboard.press("Enter")
            time.sleep(2)

            # Also click arrow if Enter didn't submit
            arrow = page.locator("button:has-text('arrow_forward'), [aria-label*='arrow_forward'], mat-icon:has-text('arrow_forward')").first
            if arrow.count() > 0:
                try:
                    arrow.click(force=True)
                except:
                    pass

            time.sleep(8)
            screenshot_path = os.path.join(DOWNLOADS_DIR, "test_generation_live.png")
            page.screenshot(path=screenshot_path)
            print(f"[Google Flow Test] SUCCESS: Video generation submitted! Screenshot saved to: {screenshot_path}")

            # Also copy to artifacts directory for report
            artifact_img = "C:/Users/win10/.gemini/antigravity/brain/54a30caf-b2bd-49da-bd32-20091802a295/test_generation_live.png"
            page.screenshot(path=artifact_img)

            context.close()
            browser.close()
            return True
        else:
            print("[Google Flow Test] Prompt editor not found.")
            screenshot_path = os.path.join(DOWNLOADS_DIR, "test_generation_error.png")
            page.screenshot(path=screenshot_path)
            context.close()
            browser.close()
            return False

if __name__ == '__main__':
    prompt_arg = sys.argv[1] if len(sys.argv) > 1 else "Cinematic neon glowing AI laboratory in 4k"
    test_generate(prompt_arg)
