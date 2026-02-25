document.addEventListener("DOMContentLoaded", () => {
  const hamburgerBtn = document.getElementById("hamburger-btn");
  const headerEl = document.querySelector("header");

  const links = [
    { href: "index.html", label: "Home" },
    { href: "about.html", label: "About Us" },
    { href: "programs.html", label: "Programs" },
    { href: "admissions.html", label: "Admissions" },
    { href: "fees.html", label: "Fees & Payments" },
    { href: "https://gpceportal.com", label: "Portal/Login" },
    { href: "support.html", label: "Support" }
  ];

  const path = window.location.pathname.split("/").pop() || "index.html";

  const navHtml = links
    .map((l) => {
      const isActive = l.href === path;
      return `<a href="${l.href}" class="mobile-menu-link${isActive ? " active" : ""}">${l.label}</a>`;
    })
    .join("");

  const overlayHtml = `
    <div id="mobile-menu-overlay" class="mobile-menu-overlay">
      <div class="mobile-menu-drawer">
        <div class="mobile-menu-header">
          <div class="brand">Grand Plus College</div>
          <button id="mobile-menu-close" class="mobile-menu-close" aria-label="Close menu">
            <i data-lucide="x"></i>
          </button>
        </div>
        <nav class="mobile-menu-nav">
          ${navHtml}
        </nav>
        <div class="mobile-menu-footer">
          <a href="apply.html" class="btn btn-primary" style="width: 100%; height: 54px; font-size: 16px; text-decoration: none;">Apply Now</a>
        </div>
      </div>
    </div>
  `;

  const existingOverlay = document.getElementById("mobile-menu-overlay");
  if (existingOverlay) {
    existingOverlay.outerHTML = overlayHtml;
  } else if (headerEl) {
    headerEl.insertAdjacentHTML("afterend", overlayHtml);
  }

  const mobileMenuOverlay = document.getElementById("mobile-menu-overlay");
  const mobileMenuClose = document.getElementById("mobile-menu-close");
  const mobileMenuLinks = document.querySelectorAll(".mobile-menu-link");

  if (hamburgerBtn && mobileMenuOverlay && mobileMenuClose) {
    hamburgerBtn.addEventListener("click", () => {
      mobileMenuOverlay.classList.add("active");
      document.body.style.overflow = "hidden";
    });

    const closeMenu = () => {
      mobileMenuOverlay.classList.remove("active");
      document.body.style.overflow = "";
    };

    mobileMenuClose.addEventListener("click", closeMenu);
    mobileMenuOverlay.addEventListener("click", (e) => {
      if (e.target === mobileMenuOverlay) closeMenu();
    });
    mobileMenuLinks.forEach((link) => link.addEventListener("click", closeMenu));
  }

  if (window.lucide && typeof window.lucide.createIcons === "function") {
    window.lucide.createIcons();
  }
});
