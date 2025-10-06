import asyncio
from playwright.async_api import async_playwright, expect
import os
import re
import json

async def main():
    async with async_playwright() as p:
        # The test hooks are added here temporarily for verification
        with open('index.html', 'r') as f:
            original_content = f.read()

        modified_content = original_content
        # Add isDebug global variable
        if "const isDebug" not in modified_content:
             modified_content = modified_content.replace(
                "const urlParams = new URLSearchParams(window.location.search);",
                "const urlParams = new URLSearchParams(window.location.search); const isDebug = urlParams.get('debug') === 'true';"
            )
        # Modify connectWallet for testing
        if "0xTEST_ADDRESS_FOR_AUTOMATION" not in modified_content:
            modified_content = modified_content.replace(
                "if (typeof window.ethereum === 'undefined')",
                "if (!isDebug && typeof window.ethereum === 'undefined')"
            )
            modified_content = modified_content.replace(
                "provider = new ethers.providers.Web3Provider(window.ethereum);",
                "if (isDebug) { userAddress = '0xTEST_ADDRESS_FOR_AUTOMATION'; } else { provider = new ethers.providers.Web3Provider(window.ethereum);"
            )
            modified_content = modified_content.replace(
                "userAddress = await signer.getAddress();",
                "userAddress = await signer.getAddress(); }"
            )
            modified_content = modified_content.replace(
                "walletAddressSpan.innerText = `${userAddress.substring(0, 6)}...${userAddress.substring(userAddress.length - 4)}`;",
                "walletAddressSpan.innerText = isDebug ? userAddress : `${userAddress.substring(0, 6)}...${userAddress.substring(userAddress.length - 4)}`;"
            )

        # Add hooks for guaranteed rewards and infinite energy for the test
        if "if (isDebug || Math.random() < REWARD_CHANCE)" not in modified_content:
            modified_content = modified_content.replace(
                "if (Math.random() < REWARD_CHANCE)",
                "if (isDebug || Math.random() < REWARD_CHANCE)"
            )
        if "if (!isDebug)" not in modified_content:
            modified_content = modified_content.replace(
                "miningEnergy--;",
                "if (!isDebug) { miningEnergy--; }"
            )

        with open('index.html', 'w') as f:
            f.write(modified_content)

        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()

        # Navigate to the local HTML file with the testing flag
        file_path = os.path.abspath('index.html')
        await page.goto(f'file://{file_path}?debug=true')

        # 1. Connect Wallet and wait for game to load using a reliable method
        await page.locator('#modal-connect-btn').click()
        # This function waits until the 'hidden' class is removed from the element,
        # which is a definitive sign that the game is ready.
        await page.wait_for_function("!document.querySelector('#game-stats').classList.contains('hidden')")

        # 2. Mine once to get a session balance
        canvas = page.locator('#gameCanvas')
        for _ in range(10):
            await canvas.click(delay=20)
        await page.wait_for_timeout(500) # Wait for animation

        session_balance_str = await page.locator('#syst-balance').inner_text()
        session_balance = float(session_balance_str)
        assert session_balance > 0, "Session balance should be greater than 0 after mining."

        # 3. Claim rewards
        await page.locator('#claim-rewards-btn').click()
        await page.wait_for_timeout(2000) # Wait for claim sequence to finish

        # 4. Verify that the total balance updated and session reset
        await expect(page.locator('#syst-balance')).to_have_text("0.0000")
        await expect(page.locator('#total-syst-balance')).to_have_text(session_balance_str)

        # 5. Take a screenshot of the updated totals
        await page.screenshot(path="jules-scratch/verification/total_updated.png")

        # 6. Reload the page to test persistence
        await page.reload()

        # 7. Reconnect and verify persisted total
        await page.locator('#modal-connect-btn').click()
        # Use the same reliable wait method again
        await page.wait_for_function("!document.querySelector('#game-stats').classList.contains('hidden')")
        await page.wait_for_timeout(500)

        await expect(page.locator('#total-syst-balance')).to_have_text(session_balance_str)
        await expect(page.locator('#syst-balance')).to_have_text("0.0000")

        # 8. Take a final screenshot
        await page.screenshot(path="jules-scratch/verification/total_persisted.png")

        await browser.close()

        # Restore the original content
        with open('index.html', 'w') as f:
            f.write(original_content)

if __name__ == '__main__':
    asyncio.run(main())