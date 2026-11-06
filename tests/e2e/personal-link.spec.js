const { test, expect } = require('@playwright/test');

// A link made for one person (/formularz?osoba=Name) is a form for adding a
// present FOR them - for a logged-in visitor too, not only for a visitor
// without an account (who gets the form anyway).
test.describe('personal link while logged in', () => {
  test('shows the add form for the person in the link, not my own list', async ({ page, request }) => {
    const res = await request.get('/api/formularz/recipients');
    const name = (await res.json()).recipients[0].name;
    await page.goto('/formularz?osoba=' + encodeURIComponent(name));
    await expect(page.locator('#addTab')).toBeVisible();
    await expect(page.locator('#editTab')).toBeHidden();
    const chosen = page.locator('#recipientSelect');
    await expect(chosen.locator('option:checked')).toHaveText(name);
    // and the way to my own presents stays on the page
    await expect(page.locator('#editMyPresentsLink')).toBeVisible();
  });

  test('without a link the logged-in visitor still lands on their own list', async ({ page }) => {
    await page.goto('/formularz');
    await expect(page.locator('#editTab')).toBeVisible();
    await expect(page.locator('#addTab')).toBeHidden();
  });
});
