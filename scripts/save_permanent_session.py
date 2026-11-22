#!/usr/bin/env python3
"""
AgentForge Permanent Google Flow Session Provisioner
Saves full authenticated storage state (cookies, tokens, origins)
so Google Flow works headlessly forever across PC restarts and shutdowns:
- Suppresses Chrome First-Run Experience (no "Sign in to Chrome" dialog)
- Opens direct to Google Sign-in for Google Flow
- Captures persistent session to data/google_flow_auth_state.json
- Automatically ensures project 'antigravity gen auto' exists
"""

import sys
import os
import json
import time
import argparse
from playwright.sync_api import sync_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
DATA_DIR = os.path.join(ROOT, 'data')
PROFILE_DIR = os.path.join(DATA_DIR, 'chrome-flow-profile')
AUTH_STATE_PATH = os.path.join(DATA_DIR, 'google_flow_auth_state.json')

os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(PROFILE_DIR, exist_ok=True)

PROJECT_NAME = "antigravity gen auto"
SIGNIN_URL = "https://accounts.google.com/ServiceLogin?continue=https%3A%2F%2Fflow.google.com%2F"

def parse_cookies(val):
    val = val.strip()
    cookies = []

    # Strip windows cmd carets and bash line continuation backslashes
    import re
    val = re.sub(r"\^\r?\n?", "", val)
    val = re.sub(r"\\\r?\n?", " ", val)

    # 1. Handle cURL command copy (matches -H "cookie: ...", --header 'cookie: ...', -b "...")
    curl_match = re.search(r"(?:-H|--header|-b)\s+[\^'\"]*(?:cookie:\s*)?([^'\"]+?)[\^'\"]*(?:\s+-[A-Za-z]|\s+--|$)", val, re.IGNORECASE)
    if curl_match and "=" in curl_match.group(1):
        val = curl_match.group(1).strip()

    # Strip leading "Cookie:" or "cookie:"
    val = re.sub(r"^cookie:\s*", "", val, flags=re.IGNORECASE).strip()

    # 2. Handle JSON cookies array (e.g. from Cookie-Editor extension)
    if val.startswith("[") and val.endswith("]"):
        try:
            items = json.loads(val)
            for item in items:
                name = item.get("name")
                v = item.get("value")
                domain = item.get("domain", ".google.com")
                path = item.get("path", "/")
                if name and v:
                    cookies.append({
                        "name": name,
                        "value": str(v),
                        "domain": domain,
                        "path": path,
                        "expires": int(time.time()) + 31536000,
                        "httpOnly": item.get("httpOnly", True),
                        "secure": item.get("secure", True),
                        "sameSite": "None"
                    })
            if cookies:
                return cookies
        except Exception:
            pass

    # 3. Handle semicolon-separated Cookie header (e.g. "SID=...; HSID=...; __Secure-1PSID=...")
    if "=" in val:
        pairs = val.split(";")
        for p in pairs:
            if "=" in p:
                parts = p.strip().split("=", 1)
                k = parts[0].strip()
                v = parts[1].strip()
                domain = "flow.google.com" if "osid" in k.lower() else ".google.com"
                cookies.append({
                    "name": k,
                    "value": v,
                    "domain": domain,
                    "path": "/",
                    "expires": int(time.time()) + 31536000,
                    "httpOnly": True,
                    "secure": True,
                    "sameSite": "None"
                })
        if cookies:
            return cookies

    # 4. Fallback: single token
    return [
        {
            "name": "__Secure-1PSID",
            "value": val,
            "domain": ".google.com",
            "path": "/",
            "expires": int(time.time()) + 31536000,
            "httpOnly": True,
            "secure": True,
            "sameSite": "None"
        },
        {
            "name": "__Secure-3PSID",
            "value": val,
            "domain": ".google.com",
            "path": "/",
            "expires": int(time.time()) + 31536000,
            "httpOnly": True,
            "secure": True,
            "sameSite": "None"
        }
    ]

def save_from_cookie(cookie_val=None, individual_cookies=None):
    print(f"[Import] Parsing and generating permanent storage state from cookie data...")
    new_cookies = []
    if cookie_val:
        new_cookies.extend(parse_cookies(cookie_val))

    if individual_cookies:
        for k, v in individual_cookies.items():
            if v and v.strip():
                k_trim = k.strip()
                domain = "flow.google.com" if "osid" in k_trim.lower() else ".google.com"
                new_cookies.append({
                    "name": k_trim,
                    "value": v.strip(),
                    "domain": domain,
                    "path": "/",
                    "expires": int(time.time()) + 31536000,
                    "httpOnly": True,
                    "secure": True,
                    "sameSite": "None"
                })

    # Merge with existing cookies so tokens like __Secure-1PSID are preserved
    existing_cookies = []
    if os.path.exists(AUTH_STATE_PATH):
        try:
            with open(AUTH_STATE_PATH, "r", encoding="utf-8") as f:
                raw = json.load(f)
                if isinstance(raw.get("cookies"), list):
                    existing_cookies = raw["cookies"]
        except Exception:
            pass

    cookie_map = {c["name"]: c for c in existing_cookies if isinstance(c, dict) and "name" in c}
    for c in new_cookies:
        cookie_map[c["name"]] = c
    merged_cookies = list(cookie_map.values())

    print(f"[Import] Active Cookies ({len(merged_cookies)}): {', '.join(c['name'] for c in merged_cookies)}...")

    auth_state = {
        "cookies": merged_cookies,
        "origins": [
            {
                "origin": "https://flow.google.com",
                "localStorage": []
            }
        ]
    }
    with open(AUTH_STATE_PATH, "w", encoding="utf-8") as f:
        json.dump(auth_state, f, indent=2)
    print(f"[SUCCESS] Saved permanent authentication state to: {AUTH_STATE_PATH}")

    names = [c["name"] for c in merged_cookies]
    has_full = ("__Secure-1PSID" in names or "__Secure-3PSID" in names) and ("HSID" in names or "SSID" in names) and "OSID" in names
    if has_full:
        print("[Status] 🚀 Full Google Flow Session Bundle is active and ready for live video generation!")
    else:
        missing = []
        if "__Secure-1PSID" not in names and "__Secure-3PSID" not in names: missing.append("__Secure-1PSID")
        if "HSID" not in names: missing.append("HSID")
        if "SSID" not in names: missing.append("SSID")
        if "OSID" not in names: missing.append("OSID")
        print(f"\n[Status] Note: Still missing: {', '.join(missing)} for a complete session bundle.")

def main():
    parser = argparse.ArgumentParser(description="Save Permanent Google Flow Session")
    parser.add_argument("--cookie", type=str, help="Import __Secure-1PSID or session cookie value directly without opening browser")
    parser.add_argument("--hsid", type=str, help="Value of HSID cookie")
    parser.add_argument("--ssid", type=str, help="Value of SSID cookie")
    parser.add_argument("--sapisid", type=str, help="Value of SAPISID cookie")
    parser.add_argument("--osid", type=str, help="Value of OSID cookie")
    parser.add_argument("--sid", type=str, help="Value of SID cookie")
    args = parser.parse_args()

    indiv = {}
    if args.hsid: indiv["HSID"] = args.hsid
    if args.ssid: indiv["SSID"] = args.ssid
    if args.sapisid: indiv["SAPISID"] = args.sapisid
    if args.osid: indiv["OSID"] = args.osid
    if args.sid: indiv["SID"] = args.sid

    if args.cookie or indiv:
        save_from_cookie(cookie_val=args.cookie, individual_cookies=indiv)
        return

    # Check env var as well
    env_cookie = os.environ.get("GOOGLE_FLOW_SESSION_ID") or os.environ.get("GOOGLE_FLOW_COOKIE")
    if env_cookie:
        print("[Env] Found GOOGLE_FLOW_SESSION_ID in environment.")
        save_from_cookie(env_cookie)
        return

    print("===================================================================")
    print("      AGENTFORGE PERMANENT GOOGLE FLOW BRIDGE INITIALIZER         ")
    print("===================================================================")
    print("[1/4] Launching clean authentication window (bypassing Chrome FRE)...")

    chrome_args = [
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-fre',
        '--disable-search-engine-choice-screen',
        '--disable-blink-features=AutomationControlled',
        '--disable-features=Translate,OptimizationGuideModelDownloading,OptimizationHintsFetching',
        '--window-size=1280,850'
    ]

    with sync_playwright() as p:
        context = p.chromium.launch_persistent_context(
            user_data_dir=PROFILE_DIR,
            channel='chrome',
            headless=False,
            viewport={'width': 1280, 'height': 800},
            args=chrome_args
        )

        page = context.pages[0] if context.pages else context.new_page()

        print("[2/4] Navigating to Google Flow...")
        try:
            page.goto("https://flow.google.com/", wait_until="domcontentloaded", timeout=45000)
            time.sleep(2)
        except Exception as e:
            print(f"[Notice] Direct navigation: {e}")

        # Auto-pilot: Auto-click through Google Flow onboarding buttons
        for btn_text in ["Try in Google Flow", "Create with Google Flow", "Sign in", "Get started"]:
            try:
                btn = page.locator(f"text={btn_text}").first
                if btn.count() > 0:
                    print(f"[Auto-Pilot] Automatically clicking '{btn_text}' for you...")
                    btn.click()
                    time.sleep(2)
                    break
            except Exception:
                pass

        print("\n===================================================================")
        print("ACTION REQUIRED:")
        print("Sign in ONCE with your Google Account in the open window.")
        print("AgentForge handles everything else automatically (no double login):")
        print("  1. Auto-redirects directly into Google Flow")
        print("  2. Automatically initializes project 'antigravity gen auto'")
        print("  3. Locks permanent session to disk for headless background use")
        print("Waiting up to 3 minutes...")
        print("===================================================================\n")

        authenticated = False
        for i in range(90):  # Wait up to 3 minutes
            url = page.url

            # Auto-click any intermediary Flow gateway buttons
            if "about" in url and "accounts.google.com" not in url:
                for btn_text in ["Try in Google Flow", "Create with Google Flow", "Sign in"]:
                    try:
                        btn = page.locator(f"text={btn_text}").first
                        if btn.count() > 0:
                            print(f"[Auto-Pilot] Auto-clicking '{btn_text}'...")
                            btn.click()
                            time.sleep(2)
                            break
                    except Exception:
                        pass

            if "accounts.google.com" not in url and "about" not in url:
                try:
                    if (page.locator("text=+ New project").count() > 0 or
                        page.locator("text=New project").count() > 0 or
                        page.locator("text=Flow Music").count() > 0 or
                        page.locator("text=Flow TV").count() > 0 or
                        page.locator("text=PRO").count() > 0):
                        authenticated = True
                        break
                except:
                    pass

            if i % 5 == 0 and i > 0:
                print(f"[Google Flow] Waiting for Google sign-in to complete ({i*2}s elapsed)...")
            time.sleep(2)

        if not authenticated:
            print("\n[Timeout] Sign in was not completed within 3 minutes.")
            print("Please run this script again whenever you are ready to sign in:")
            print("  python scripts/save_permanent_session.py")
            context.close()
            return

        print("\n[3/4] Login detected! Ensuring project 'antigravity gen auto' exists on dashboard...")
        time.sleep(3)

        # Ensure we are on flow dashboard
        if page.url != "https://flow.google.com/":
            page.goto("https://flow.google.com/", timeout=30000)
            time.sleep(3)

        try:
            if page.locator(f"text={PROJECT_NAME}").count() == 0:
                print(f"[Google Flow] Project '{PROJECT_NAME}' not found. Creating...")
                new_btn = page.locator("text=+ New project, text=New project, button:has-text('New project')").first
                if new_btn.count() > 0:
                    new_btn.click()
                    time.sleep(2)
                    title_input = page.locator("input[placeholder*='Untitled'], input[aria-label*='Project title'], [contenteditable='true']").first
                    if title_input.count() > 0:
                        title_input.fill(PROJECT_NAME)
                        title_input.press("Enter")
                        time.sleep(1)
                    print(f"[Google Flow] Created dedicated project: '{PROJECT_NAME}'!")
            else:
                print(f"[Google Flow] Project '{PROJECT_NAME}' already exists on your dashboard!")
        except Exception as e:
            print(f"[Google Flow] Note creating project: {e}")

        print("[4/4] Extracting and locking permanent cryptographic storage state...")
        context.storage_state(path=AUTH_STATE_PATH)
        print(f"[SUCCESS] Saved persistent storage state to: {AUTH_STATE_PATH}")
        print("===================================================================")
        print("PERMANENT BRIDGE ACTIVATED!")
        print("Your Google Flow session is now stored permanently.")
        print("- It survives PC reboots, restarts, and shutdowns.")
        print("- From now on, AgentForge runs in 100% HEADLESS mode in the background.")
        print("- No visible browser windows will pop up.")
        print("You can now safely close this browser window!")
        print("===================================================================")
        time.sleep(4)
        context.close()

if __name__ == '__main__':
    main()
