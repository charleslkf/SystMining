import asyncio
from playwright.async_api import async_playwright, expect
import os
import re

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()

        # Navigate to the game with the debug flag.
        # The debug mode in the game will set up the test scenario for us.
        file_path = os.path.abspath('index.html')
        await page.goto(f'file://{file_path}?debug=true')

        # 1. Connect Wallet. The debug mode will handle the test user.
        await page.locator('#modal-connect-btn').click()
        await expect(page.locator('#notification p')).to_have_text(re.compile(r"Mining Node Tier \d detected! Starting game."), timeout=10000)

        # Give the "Find Wall on Load" logic time to run.
        await page.wait_for_timeout(1000)

        # 2. Take a screenshot to verify the miner has moved to the wall.
        await page.screenshot(path="jules-scratch/verification/find_wall_test.png")

        # 3. Assert the miner's position programmatically to be certain.
        miner_state = await page.evaluate("() => window.miner")
        # The miner should stop at x=16, which is the last empty space before the wall at x=18
        assert miner_state['x'] == 16, f"Miner should be at x=16, but is at x={miner_state['x']}"
        assert miner_state['y'] == 5, f"Miner should be at y=5, but is at y={miner_state['y']}"

        # 4. Turn the miner around to face the empty space.
        await page.evaluate("() => { window.miner.dir = -1; }")
        await page.wait_for_timeout(200)

        # 5. Get the current SYST balance.
        initial_syst_str = await page.locator('#syst-balance').inner_text()

        # 6. Click 10 times in the empty space.
        canvas = page.locator('#gameCanvas')
        for _ in range(10):
            await canvas.click(delay=20)

        await page.wait_for_timeout(500)

        # 7. Assert that the balance has NOT changed.
        await expect(page.locator('#syst-balance')).to_have_text(initial_syst_str)

        # 8. Take a final screenshot to prove no rewards were gained.
        await page.screenshot(path="jules-scratch/verification/no_mining_air.png")

        await browser.close()

if __name__ == '__main__':
    asyncio.run(main())