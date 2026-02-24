document.addEventListener("DOMContentLoaded", () => {
  const hamburgerBtn = document.getElementById("hamburger-btn");
  const mobileMenuOverlay = document.getElementById("mobile-menu-overlay");
  const mobileMenuClose = document.getElementById("mobile-menu-close");
  const mobileMenuLinks = document.querySelectorAll(".mobile-menu-link");

  if (hamburgerBtn && mobileMenuOverlay && mobileMenuClose) {
    // Open menu
    hamburgerBtn.addEventListener("click", () => {
      mobileMenuOverlay.classList.add("active");
      document.body.style.overflow = "hidden"; // Prevent scrolling
    });

    // Close menu
    const closeMenu = () => {
      mobileMenuOverlay.classList.remove("active");
      document.body.style.overflow = ""; // Restore scrolling
    };

    mobileMenuClose.addEventListener("click", closeMenu);

    // Close when clicking outside drawer
    mobileMenuOverlay.addEventListener("click", (e) => {
      if (e.target === mobileMenuOverlay) {
        closeMenu();
      }
    });

    // Close on link click
    mobileMenuLinks.forEach((link) => {
      link.addEventListener("click", closeMenu);
    });
  }
});
