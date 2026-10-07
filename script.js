// ==========================================================
// 1. SHOW THE CURRENT YEAR IN THE FOOTER
// The year is calculated by the browser, so it never goes out of date.
// ==========================================================
const yearElement = document.getElementById('year');   // find <span id="year"> in the HTML
yearElement.textContent = new Date().getFullYear();    // write the current year inside it


// ==========================================================
// 2. REPLAY THE LOGO ANIMATION WHEN THE LOGO IS CLICKED
// ==========================================================
const logo = document.querySelector('.logo');          // find the logo
const bars = logo.querySelectorAll('.bar');            // find the four bars inside it

logo.addEventListener('click', () => {
  bars.forEach((bar) => {
    bar.style.animation = 'none';       // stop the animation and reset the bar
    void bar.getBoundingClientRect();   // force the browser to apply the reset
    bar.style.animation = '';           // give control back to the CSS, so it plays again
  });
});