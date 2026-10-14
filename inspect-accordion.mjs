import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  try {
    await page.goto('http://localhost:3002/home.html', { waitUntil: 'networkidle' });
    
    // Check if we're on login page
    const url = page.url();
    console.log(`Current URL: ${url}\n`);
    
    // Wait for page content to load
    await page.waitForTimeout(5000);

    // Get all elements that might have border-radius
    const elements = await page.evaluate(() => {
      const results = [];
      
      // Check accordion-button
      const buttons = document.querySelectorAll('.accordion-button');
      buttons.forEach((btn, i) => {
        const style = window.getComputedStyle(btn);
        results.push({
          type: 'accordion-button',
          index: i,
          text: btn.textContent.trim().substring(0, 30),
          borderRadius: style.borderRadius,
          borderTopLeftRadius: style.borderTopLeftRadius,
          borderTopRightRadius: style.borderTopRightRadius,
          borderBottomLeftRadius: style.borderBottomLeftRadius,
          borderBottomRightRadius: style.borderBottomRightRadius,
        });
      });

      // Check accordion-item
      const items = document.querySelectorAll('.accordion-item');
      items.forEach((item, i) => {
        const style = window.getComputedStyle(item);
        results.push({
          type: 'accordion-item',
          index: i,
          borderRadius: style.borderRadius,
          borderTopLeftRadius: style.borderTopLeftRadius,
          borderTopRightRadius: style.borderTopRightRadius,
          borderBottomLeftRadius: style.borderBottomLeftRadius,
          borderBottomRightRadius: style.borderBottomRightRadius,
        });
      });

      // Check accordion itself
      const accordions = document.querySelectorAll('.accordion');
      accordions.forEach((acc, i) => {
        const style = window.getComputedStyle(acc);
        results.push({
          type: 'accordion',
          index: i,
          borderRadius: style.borderRadius,
        });
      });

      return results;
    });

    console.log('=== ACCORDION ELEMENT STYLES ===\n');
    elements.forEach(el => {
      console.log(`${el.type} [${el.index}]${el.text ? ` - ${el.text}` : ''}`);
      if (el.borderRadius) console.log(`  borderRadius: ${el.borderRadius}`);
      if (el.borderTopLeftRadius) {
        console.log(`  top-left: ${el.borderTopLeftRadius}, top-right: ${el.borderTopRightRadius}`);
        console.log(`  bottom-left: ${el.borderBottomLeftRadius}, bottom-right: ${el.borderBottomRightRadius}`);
      }
      console.log();
    });

    await browser.close();
  } catch (err) {
    console.error('Error:', err.message);
    await browser.close();
    process.exit(1);
  }
})();
